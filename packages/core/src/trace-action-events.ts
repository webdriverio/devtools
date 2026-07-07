// Builds the before/after action events of the exported trace stream,
// including tracingGroup test boundaries and frame-snapshot ref stamping.

import type { CommandLog, TestMetadataMap } from '@wdio/devtools-shared'
import {
  ASSERT_ACTION_CLASS,
  formatActionTitle,
  mapCommandToAction,
  FILL_METHODS,
  type TraceAction
} from './action-mapping.js'
import { callSourceToStack, type StackFrame } from './trace-sources.js'
import type { FrameSnapshotIndex } from './trace-frame-snapshots.js'

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
  /** CallId of the Tracing.tracingGroup that wraps this action (if any). */
  parentId?: string
  /** Frame-snapshot name rendered as the action's after state. */
  afterSnapshot?: string
}

export type ActionEvent = BeforeEvent | AfterEvent

interface ActionStream {
  events: ActionEvent[]
  prevEndMs: number
  callCounter: number
  lastTestUid?: string
  groupCallId?: string
}

// Nightwatch built-in assertions collapse {passed, actual, expected, message}
// into the command result on failure — surface those over positional args.
interface CollapsedAssertResult {
  passed?: unknown
  actual?: unknown
  expected?: unknown
  message?: unknown
}

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

function closeGroup(stream: ActionStream): void {
  if (!stream.lastTestUid || !stream.groupCallId) {
    return
  }
  stream.callCounter++
  stream.events.push({
    type: 'after',
    callId: stream.groupCallId,
    endTime: stream.prevEndMs
  })
}

// When the testUid changes, close the previous Tracing.tracingGroup and open
// a new one; child actions reference it via parentId to render as spans.
function handleTestBoundary(
  stream: ActionStream,
  cmd: CommandLog,
  pageId: string,
  wallTime: number,
  testMetadata?: TestMetadataMap
): void {
  if (!cmd.testUid || cmd.testUid === stream.lastTestUid) {
    return
  }
  closeGroup(stream)
  stream.callCounter++
  stream.groupCallId = `call@${stream.callCounter}`
  const groupName = testMetadata?.get(cmd.testUid)?.title ?? cmd.testUid
  stream.events.push({
    type: 'before',
    callId: stream.groupCallId,
    startTime: Math.max(
      stream.prevEndMs,
      (cmd.startTime ?? cmd.timestamp) - wallTime
    ),
    class: 'Tracing',
    method: 'tracingGroup',
    pageId,
    params: { name: groupName },
    title: groupName,
    apiName: 'tracing.tracingGroup'
  })
  stream.lastTestUid = cmd.testUid
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
    parentId: stream.groupCallId
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
  const afterEvent: AfterEvent = { type: 'after', callId, endTime: endMs }
  const error = actionError(cmd, action.class === ASSERT_ACTION_CLASS)
  if (error) {
    afterEvent.error = error
  }
  const afterName = snapshotIndex?.claimAfter(cmd.timestamp, callId)
  if (afterName) {
    afterEvent.afterSnapshot = afterName
  }
  stream.events.push(afterEvent)
  stream.prevEndMs = endMs
}

export function buildActionEvents(
  commands: CommandLog[],
  pageId: string,
  wallTime: number,
  testMetadata?: TestMetadataMap,
  snapshotIndex?: FrameSnapshotIndex
): ActionEvent[] {
  const stream: ActionStream = { events: [], prevEndMs: 0, callCounter: 0 }
  for (const cmd of commands) {
    const action = mapCommandToAction(cmd.command)
    if (!action) {
      continue
    }
    handleTestBoundary(stream, cmd, pageId, wallTime, testMetadata)
    pushActionPair(stream, cmd, action, pageId, wallTime, snapshotIndex)
  }
  closeGroup(stream)
  return stream.events
}
