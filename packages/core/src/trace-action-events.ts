// Builds the before/after action events of the exported trace stream,
// including tracingGroup test boundaries and frame-snapshot ref stamping.

import type {
  CollapsedAssertResult,
  CommandLog,
  TestMetadataMap
} from '@wdio/devtools-shared'
import { POINTABLE_METHODS } from '@wdio/devtools-shared'
import {
  ASSERT_ACTION_CLASS,
  formatActionTitle,
  mapCommandToAction,
  FILL_METHODS,
  type TraceAction
} from './action-mapping.js'
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
  /** CallId of the Tracing.tracingGroup that wraps this action (if any). */
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

// An adapter may attach a normalized CollapsedAssertResult (see shared) to an
// assertion command — prefer its actual/expected over the positional args,
// which are only correct for node:assert-style `[actual, expected]` calls.
function collapsedAssertResult(
  result: unknown
): CollapsedAssertResult | undefined {
  if (typeof result === 'object' && result !== null && 'passed' in result) {
    return result as CollapsedAssertResult
  }
  return undefined
}

// Assert params: node:assert positional order (actual, expected, message?),
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

function actionError(
  cmd: CommandLog,
  isAssert: boolean
): { message: string } | undefined {
  if (cmd.error) {
    const err = cmd.error as { message?: string }
    return { message: err.message ?? String(cmd.error) }
  }
  if (isAssert) {
    // Nightwatch assert failures carry no Error — only the collapsed result.
    const collapsed = collapsedAssertResult(cmd.result)
    if (collapsed && collapsed.passed === false) {
      return { message: String(collapsed.message ?? 'Assertion failed') }
    }
  }
  return undefined
}

/** Centre of the element a pointer action matched, from the captured element
 *  rects at the command's completion. Undefined for non-pointer actions, a
 *  non-string selector, or a selector absent from the captured elements (e.g. a
 *  WDIO text/xpath locator `getSelector` didn't reproduce). */
function resolveActionPoint(
  action: TraceAction,
  cmd: CommandLog,
  snapshotIndex?: FrameSnapshotIndex
): { x: number; y: number } | undefined {
  if (action.class !== 'Element' || !POINTABLE_METHODS.has(action.method)) {
    return undefined
  }
  const selector = cmd.args?.[0]
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
    if (e.selector === selector && e.boundingBox) {
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
  const error = actionError(cmd, action.class === ASSERT_ACTION_CLASS)
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

function pushActionPair(
  stream: ActionStream,
  cmd: CommandLog,
  action: TraceAction,
  pageId: string,
  wallTime: number,
  snapshotIndex?: FrameSnapshotIndex
): void {
  stream.callCounter++
  const callId = `call@${stream.callCounter}`
  // Command invocation timestamp, falling back to completion when absent.
  const rawStartMs = (cmd.startTime ?? cmd.timestamp) - wallTime
  const rawEndMs = cmd.timestamp - wallTime
  // Floor at prevEndMs to prevent visual overlap with the previous action.
  const startMs = Math.max(stream.prevEndMs, rawStartMs)
  // +1ms minimum duration so an `after` never precedes its parsed `before`.
  const endMs = Math.max(startMs + 1, rawEndMs)
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
    parentId: stream.openGroups[stream.openGroups.length - 1]?.callId
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
  stream.events.push(buildAfterEvent(cmd, action, callId, endMs, snapshotIndex))
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
  // late but carry their real call-time `startTime`; since pushActionPair floors
  // each start at the running prevEndMs, out-of-order input would clamp those
  // late rows to the end of the timeline (clustering them after the last real
  // command). A stable sort by start time restores true positions and keeps
  // equal-time rows in insertion order (each command owns its own before/after
  // pair, so pairing is unaffected).
  const ordered = [...commands].sort(
    (a, b) => (a.startTime ?? a.timestamp) - (b.startTime ?? b.timestamp)
  )
  for (const cmd of ordered) {
    const action = mapCommandToAction(cmd.command)
    if (!action) {
      continue
    }
    syncGroups(stream, cmd, pageId, wallTime, testMetadata)
    pushActionPair(stream, cmd, action, pageId, wallTime, snapshotIndex)
  }
  closeGroupsFrom(stream, 0)
  return stream.events
}
