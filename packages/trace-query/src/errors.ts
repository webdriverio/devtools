import {
  isFailedRequest,
  retriedRows,
  stripAnsi,
  type ConsoleLog,
  type NetworkRequest,
  type TracePlayerData
} from '@wdio/devtools-shared'
import { actionTree } from './action-list.js'
import { ownFailure, sinceStart } from './actions.js'
import { clipText, pageOf } from './budget.js'
import {
  ACTION_STATUS,
  MAX_LIST_TEXT_CHARS,
  MAX_TITLE_CHARS,
  PAGE_SCOPE,
  TRACE_ERROR_KIND
} from './constants.js'
import { traceStateOf } from './open-trace.js'
import { stepsFailedOnTheirOwn } from './steps.js'
import type {
  ActionNode,
  FailedStep,
  OrderedAction,
  Page,
  PageRequest,
  TraceError,
  TraceHandle
} from './types.js'

function consoleText(log: ConsoleLog): string {
  const parts = log.args.map((arg) =>
    typeof arg === 'string' ? arg : JSON.stringify(arg)
  )
  return stripAnsi(parts.join(' ')).trim()
}

// A zip's HAR keeps a transport failure's text, when the capture side had one, as the status text of its status 0.
function requestMessage(request: NetworkRequest): string {
  if (!request.status) {
    return request.statusText || 'No response'
  }
  return `HTTP ${request.status} ${request.statusText ?? ''}`.trim()
}

function actionError(action: OrderedAction): TraceError {
  const { command } = action
  return {
    kind: TRACE_ERROR_KIND.ACTION,
    timeMs: action.startMs,
    callId: action.callId,
    title: clipText(command.title ?? command.command, MAX_TITLE_CHARS),
    message: clipText(ownFailure(command) ?? '', MAX_LIST_TEXT_CHARS)
  }
}

function stepError(data: TracePlayerData, step: FailedStep): TraceError {
  return {
    kind: TRACE_ERROR_KIND.STEP,
    timeMs: sinceStart(data, step.startTime),
    callId: step.callId,
    title: clipText(step.title, MAX_TITLE_CHARS),
    message: clipText(step.error, MAX_LIST_TEXT_CHARS)
  }
}

type LastStarted = (timeMs: number) => { callId?: string }

/** The action last started at or before a moment; nothing before the first action. */
function lastStartedBefore(tree: readonly ActionNode[]): LastStarted {
  return (timeMs) => {
    let last: string | undefined
    for (const { action } of tree) {
      if (action.startMs > timeMs) {
        break
      }
      last = action.callId
    }
    return last === undefined ? {} : { callId: last }
  }
}

function consoleError(
  data: TracePlayerData,
  log: ConsoleLog,
  near: LastStarted
): TraceError {
  const timeMs = sinceStart(data, log.timestamp)
  return {
    kind: TRACE_ERROR_KIND.CONSOLE,
    timeMs,
    ...near(timeMs),
    message: clipText(consoleText(log), MAX_LIST_TEXT_CHARS)
  }
}

function requestError(
  data: TracePlayerData,
  request: NetworkRequest,
  near: LastStarted
): TraceError {
  const timeMs = sinceStart(data, request.startTime)
  return {
    kind: TRACE_ERROR_KIND.REQUEST,
    timeMs,
    ...near(timeMs),
    message: clipText(requestMessage(request), MAX_LIST_TEXT_CHARS),
    ...(request.method ? { method: request.method } : {}),
    url: clipText(request.url, MAX_LIST_TEXT_CHARS),
    ...(request.status !== undefined ? { status: request.status } : {})
  }
}

/** Failed top-level actions, steps that failed on their own, console errors and failed requests, by time. */
export function collectErrors(data: TracePlayerData): TraceError[] {
  const { consoleLogs, networkRequests, commands } = data.trace
  const tree = actionTree(data)
  const near = lastStartedBefore(tree)
  return [
    ...tree
      .filter((node) => node.status === ACTION_STATUS.FAILED)
      .map((node) => actionError(node.action)),
    ...stepsFailedOnTheirOwn(data, retriedRows(commands)).map((step) =>
      stepError(data, step)
    ),
    ...consoleLogs
      .filter((log) => log.type === 'error')
      .map((log) => consoleError(data, log, near)),
    ...networkRequests
      .filter(isFailedRequest)
      .map((request) => requestError(data, request, near))
  ].sort((a, b) => a.timeMs - b.timeMs)
}

/** Every error the trace records, in time order, a page at a time. A failed wait is listed once; its failed polls are in its detail and its action row. */
export function traceErrors(
  handle: TraceHandle,
  request: PageRequest = {}
): Page<TraceError> {
  return pageOf(collectErrors(traceStateOf(handle).data), request, {
    scope: PAGE_SCOPE.ERRORS
  })
}
