// Builds the before/after action events of the exported trace stream,
// including tracingGroup test boundaries and frame-snapshot ref stamping.

import type {
  CommandLog,
  CommandNode,
  TestMetadataMap
} from '@wdio/devtools-shared'
import {
  collapsedAssertResult,
  commandFailure,
  locatorsMatch,
  nestCommands,
  POINTABLE_METHODS
} from '@wdio/devtools-shared'
import {
  ASSERT_ACTION_CLASS,
  formatActionTitle,
  mapCommandToAction,
  FILL_METHODS,
  type TraceAction
} from '@wdio/devtools-shared'
import { callSourceToStack, type StackFrame } from './trace-sources.js'
import type { FrameSnapshotIndex } from './trace-frame-snapshots.js'
import { buildGroupPath } from './trace-hierarchy.js'

export interface BeforeEvent {
  type: 'before'
  callId: string
  startTime: number
  class: string
  method: string
  pageId: string
  params: Record<string, unknown>
  title: string
  /** Trace-viewer API name (e.g. 'page.goBack', 'element.click'). */
  apiName: string
  /** CallId of the action whose execution issued this one, else of the Tracing.tracingGroup that wraps it (if any). */
  parentId?: string
  /** User-code frame the command was issued from, when captured. */
  stack?: StackFrame[]
  /** Frame-snapshot name rendered as the action's before state. */
  beforeSnapshot?: string
}

export interface AfterEvent {
  type: 'after'
  callId: string
  endTime: number
  error?: { message: string }
  /** Command return value (e.g. the text getText resolved to). */
  result?: unknown
  /** CallId of the Tracing.tracingGroup that wraps this action (if any). */
  parentId?: string
  /** Frame-snapshot name rendered as the action's after state. */
  afterSnapshot?: string
  /** Page-coordinate hit point (centre of the matched element) for pointer
   *  actions — drives the player's click marker + timeline pointer glyph. */
  point?: { x: number; y: number }
}

// Serialized command results over this size are dropped from the trace — a
// huge execute() return shouldn't bloat every action line.
const MAX_RESULT_BYTES = 64 * 1024

/** JSON-safe command result within the size cap; undefined when absent,
 *  oversized, or not serializable. */
function serializableResult(result: unknown): unknown {
  if (result === undefined) {
    return undefined
  }
  try {
    const json = JSON.stringify(result)
    if (json === undefined || json.length > MAX_RESULT_BYTES) {
      return undefined
    }
    return JSON.parse(json)
  } catch {
    return undefined
  }
}

export type ActionEvent = BeforeEvent | AfterEvent

interface ActionStream {
  events: ActionEvent[]
  prevEndMs: number
  callCounter: number
  /** Currently-open tracingGroup path, outermost first (feature→scenario→step).
   *  Actions nest under the innermost entry. */
  openGroups: { uid: string; callId: string }[]
}

// Assert params: a collapsed result's actual/expected win over the positional
// args, which are only right for node:assert-style `[actual, expected]` calls.
// Otherwise node:assert positional order (actual, expected, message?),
// plus a numeric echo of the raw args so the reader's paramsToArgs inverse
// reconstructs the original arg list without assert-specific knowledge.
function buildAssertParams(cmd: CommandLog): Record<string, unknown> {
  const params: Record<string, unknown> = Object.fromEntries(
    cmd.args.map((arg, index) => [String(index), arg])
  )
  const [actual, expected, message] = cmd.args
  const collapsed = collapsedAssertResult(cmd.result)
  const semantic = {
    actual: collapsed?.actual ?? actual,
    expected: collapsed?.expected ?? expected,
    message: collapsed?.message ?? message
  }
  for (const [key, value] of Object.entries(semantic)) {
    if (value !== undefined) {
      params[key] = value
    }
  }
  return params
}

// Semantic params from positional args (selector/value/url), falling back to
// index keys; the reader's paramsToArgs is the inverse.
function buildActionParams(
  action: TraceAction,
  rawArgs: unknown[]
): Record<string, unknown> {
  const isValueMethod = FILL_METHODS.has(action.method)
  if (action.class === 'Element' && isValueMethod && rawArgs.length >= 2) {
    return { selector: rawArgs[0], value: rawArgs[1] }
  }
  if (action.class === 'Element' && isValueMethod && rawArgs.length === 1) {
    return { value: rawArgs[0] }
  }
  if (
    action.class === 'Element' &&
    rawArgs.length === 1 &&
    typeof rawArgs[0] === 'string'
  ) {
    return { selector: rawArgs[0] }
  }
  if (rawArgs.length === 1 && typeof rawArgs[0] === 'string') {
    return { url: rawArgs[0] }
  }
  return Object.fromEntries(rawArgs.map((a, i) => [String(i), a]))
}

function closeGroupsFrom(stream: ActionStream, from: number): void {
  // Innermost-first so nested after events stay balanced.
  for (let i = stream.openGroups.length - 1; i >= from; i--) {
    stream.events.push({
      type: 'after',
      callId: stream.openGroups[i].callId,
      endTime: stream.prevEndMs
    })
  }
  stream.openGroups.length = Math.max(0, from)
}

// Diff the command's desired group path (feature→scenario→step, or just the
// test) against the open stack: close the diverged tail, then open the new tail
// with parentId chaining so the reader nests them. Actions then reference the
// innermost open group. A path of length ≤1 with no ancestry/step reproduces
// the previous single-group-per-test output.
function syncGroups(
  stream: ActionStream,
  cmd: CommandLog,
  pageId: string,
  wallTime: number,
  testMetadata?: TestMetadataMap
): void {
  const desired = buildGroupPath(cmd, testMetadata)
  let common = 0
  while (
    common < stream.openGroups.length &&
    common < desired.length &&
    stream.openGroups[common].uid === desired[common].uid
  ) {
    common++
  }
  closeGroupsFrom(stream, common)
  for (let i = common; i < desired.length; i++) {
    stream.callCounter++
    const callId = `call@${stream.callCounter}`
    const parentId = stream.openGroups[i - 1]?.callId
    const groupBefore: BeforeEvent = {
      type: 'before',
      callId,
      startTime: Math.max(
        stream.prevEndMs,
        (cmd.startTime ?? cmd.timestamp) - wallTime
      ),
      class: 'Tracing',
      method: 'tracingGroup',
      pageId,
      params: { name: desired[i].title },
      title: desired[i].title,
      apiName: 'tracing.tracingGroup'
    }
    if (parentId) {
      groupBefore.parentId = parentId
    }
    stream.events.push(groupBefore)
    stream.openGroups.push({ uid: desired[i].uid, callId })
  }
}

function buildParamsAndTitle(
  action: TraceAction,
  cmd: CommandLog
): { params: Record<string, unknown>; title: string } {
  const isAssert = action.class === ASSERT_ACTION_CLASS
  const params = isAssert
    ? buildAssertParams(cmd)
    : buildActionParams(action, cmd.args)
  // The element this command targeted, under a key distinct from `selector` so
  // it never feeds `paramsToArgs` — lets the reader restore CommandLog.selector
  // for the player's overlay even when args carry an assertion's expected value.
  if (cmd.selector && params.locator === undefined) {
    params.locator = cmd.selector
  }
  return {
    params,
    title: formatActionTitle(
      action,
      cmd.args,
      params,
      isAssert ? cmd.command : undefined
    )
  }
}

/** Centre of the element a pointer action matched, from the captured element
 *  rects at the command's completion. Undefined for non-pointer actions, a
 *  non-string selector, or a selector absent from the captured elements (e.g. a
 *  WDIO text/xpath locator `getSelector` didn't reproduce). A runner that acts
 *  through a resolved element handle leaves nothing selector-shaped in `args`
 *  (Selenium: the handle is the receiver, the args hold only the typed value), so
 *  the row's recorded locator is read first. */
function resolveActionPoint(
  action: TraceAction,
  cmd: CommandLog,
  snapshotIndex?: FrameSnapshotIndex
): { x: number; y: number } | undefined {
  if (action.class !== 'Element' || !POINTABLE_METHODS.has(action.method)) {
    return undefined
  }
  const selector = cmd.selector ?? cmd.args?.[0]
  if (typeof selector !== 'string') {
    return undefined
  }
  const elements = snapshotIndex?.elementsAt(cmd.timestamp)
  for (const el of elements ?? []) {
    // Narrow the unknown element record at the boundary (element-scripts shape).
    const e = el as {
      selector?: string
      boundingBox?: { x: number; y: number; width: number; height: number }
    }
    if (e.selector && locatorsMatch(e.selector, selector) && e.boundingBox) {
      const bb = e.boundingBox
      return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }
    }
  }
  return undefined
}

function buildAfterEvent(
  cmd: CommandLog,
  action: TraceAction,
  callId: string,
  endMs: number,
  snapshotIndex?: FrameSnapshotIndex
): AfterEvent {
  const afterEvent: AfterEvent = { type: 'after', callId, endTime: endMs }
  const error = commandFailure(cmd, action)
  if (error) {
    afterEvent.error = error
  }
  const result = serializableResult(cmd.result)
  if (result !== undefined) {
    afterEvent.result = result
  }
  const afterName = snapshotIndex?.claimAfter(cmd.timestamp, callId)
  if (afterName) {
    afterEvent.afterSnapshot = afterName
  }
  const point = resolveActionPoint(action, cmd, snapshotIndex)
  if (point) {
    afterEvent.point = point
  }
  return afterEvent
}

function pushBefore(
  stream: ActionStream,
  cmd: CommandLog,
  action: TraceAction,
  pageId: string,
  wallTime: number,
  parentCallId: string | undefined,
  snapshotIndex?: FrameSnapshotIndex
): { callId: string; startMs: number } {
  stream.callCounter++
  const callId = `call@${stream.callCounter}`
  // Command invocation timestamp, falling back to completion when absent.
  const rawStartMs = (cmd.startTime ?? cmd.timestamp) - wallTime
  // Floor at prevEndMs to prevent visual overlap with the previous action.
  const startMs = Math.max(stream.prevEndMs, rawStartMs)
  const { params, title } = buildParamsAndTitle(action, cmd)
  const beforeEvent: BeforeEvent = {
    type: 'before',
    callId,
    startTime: startMs,
    class: action.class,
    method: action.method,
    pageId,
    params,
    title,
    apiName: `${action.class.toLowerCase()}.${action.method}`,
    parentId:
      parentCallId ?? stream.openGroups[stream.openGroups.length - 1]?.callId
  }
  const stack = callSourceToStack(cmd.callSource)
  if (stack) {
    beforeEvent.stack = stack
  }
  const beforeName = snapshotIndex?.beforeName()
  if (beforeName) {
    beforeEvent.beforeSnapshot = beforeName
  }
  stream.events.push(beforeEvent)
  return { callId, startMs }
}

interface EmitContext {
  pageId: string
  wallTime: number
  snapshotIndex?: FrameSnapshotIndex
}

// A row's before, then the rows it issued (nested under its callId), then its after: the after closes once the last
// child has, so the player draws the children inside the parent's span. A row the vocabulary drops passes its
// children up to the level it would have held.
function emitNode(
  stream: ActionStream,
  node: CommandNode,
  ctx: EmitContext,
  parentCallId?: string
): void {
  const cmd = node.command
  const action = mapCommandToAction(cmd.command)
  if (!action) {
    for (const child of node.children) {
      emitNode(stream, child, ctx, parentCallId)
    }
    return
  }
  const { callId, startMs } = pushBefore(
    stream,
    cmd,
    action,
    ctx.pageId,
    ctx.wallTime,
    parentCallId,
    ctx.snapshotIndex
  )
  if (node.children.length) {
    stream.prevEndMs = startMs
    for (const child of node.children) {
      emitNode(stream, child, ctx, callId)
    }
  }
  // +1ms minimum duration so an `after` never precedes its parsed `before`.
  const endMs = Math.max(
    startMs + 1,
    cmd.timestamp - ctx.wallTime,
    node.children.length ? stream.prevEndMs : 0
  )
  stream.events.push(
    buildAfterEvent(cmd, action, callId, endMs, ctx.snapshotIndex)
  )
  stream.prevEndMs = endMs
}

export function buildActionEvents(
  commands: CommandLog[],
  pageId: string,
  wallTime: number,
  testMetadata?: TestMetadataMap,
  snapshotIndex?: FrameSnapshotIndex
): ActionEvent[] {
  const stream: ActionStream = {
    events: [],
    prevEndMs: 0,
    callCounter: 0,
    openGroups: []
  }
  // Process in chronological order, not insertion order. Deferred rows (e.g.
  // Nightwatch native asserts, finalized in one batch at test-end) are appended
  // late but carry their real call-time `startTime`; since pushBefore floors
  // each start at the running prevEndMs, out-of-order input would clamp those
  // late rows to the end of the timeline (clustering them after the last real
  // command). A stable sort by start time restores true positions. `sequence`
  // then breaks ties the millisecond clock can't: a deferred row issued
  // microseconds before the command that follows it reads as the same
  // `startTime`, and insertion order put it after — which is how an assert that
  // ran on the secure page landed below the logout click it preceded. Each
  // command owns its own before/after pair, so pairing is unaffected.
  const ordered = [...commands].sort(
    (a, b) =>
      (a.startTime ?? a.timestamp) - (b.startTime ?? b.timestamp) ||
      (a.sequence ?? 0) - (b.sequence ?? 0)
  )
  const ctx: EmitContext = { pageId, wallTime, snapshotIndex }
  for (const node of nestCommands(ordered)) {
    if (hasAction(node)) {
      syncGroups(stream, node.command, pageId, wallTime, testMetadata)
    }
    emitNode(stream, node, ctx)
  }
  closeGroupsFrom(stream, 0)
  return stream.events
}

// A dropped row with no mapped descendant emits nothing, so it must not open or close a test group either.
function hasAction(node: CommandNode): boolean {
  return (
    Boolean(mapCommandToAction(node.command.command)) ||
    node.children.some(hasAction)
  )
}
