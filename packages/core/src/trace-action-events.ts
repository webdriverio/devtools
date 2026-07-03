// Builds the before/after action events of the exported trace stream,
// including tracingGroup test boundaries and frame-snapshot ref stamping.

import type { CommandLog, TestMetadataMap } from '@wdio/devtools-shared'
import {
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
  const params = buildActionParams(action, cmd.args)
  const beforeEvent: BeforeEvent = {
    type: 'before',
    callId,
    startTime: startMs,
    class: action.class,
    method: action.method,
    pageId,
    params,
    title: formatActionTitle(action, cmd.args, params),
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
  if (cmd.error) {
    const err = cmd.error as { message?: string }
    afterEvent.error = { message: err.message ?? String(cmd.error) }
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
