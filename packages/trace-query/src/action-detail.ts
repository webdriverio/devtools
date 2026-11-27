import {
  collapsedAssertResult,
  retriedRows,
  type CollapsedAssertResult,
  type CommandLog,
  type TracePlayerData
} from '@wdio/devtools-shared'
import {
  actionByCallId,
  actionId,
  actionStatus,
  ownFailure
} from './actions.js'
import { clipText, clipValue, queryBudgetOf } from './budget.js'
import {
  ACTION_STATUS,
  DEFAULT_SOURCE_CONTEXT_LINES,
  DETAIL_TEXT_STEPS,
  MAX_LISTED_CHILDREN,
  MAX_LIST_TEXT_CHARS,
  MAX_SOURCE_CONTEXT_LINES,
  MAX_SOURCE_LINE_CHARS,
  MAX_TITLE_CHARS
} from './constants.js'
import { traceStateOf } from './open-trace.js'
import { sourceAround } from './source-lines.js'
import { stepPathOf } from './steps.js'
import type {
  ActionDetail,
  ActionDetailOptions,
  ActionError,
  DetailBasis,
  DetailCut,
  TraceHandle
} from './types.js'

// The zip keeps an error's message alone, so a failed assertion's collapsed result is the only record of expected and actual.
function failedAssertion(
  command: CommandLog
): CollapsedAssertResult | undefined {
  const collapsed = collapsedAssertResult(command.result)
  return collapsed?.passed === false ? collapsed : undefined
}

function errorOf(command: CommandLog, text: number): ActionError | undefined {
  const message = ownFailure(command)
  if (message === undefined) {
    return undefined
  }
  const values = failedAssertion(command)
  const expected = clipValue(values?.expected, text)
  const actual = clipValue(values?.actual, text)
  return {
    message: clipText(message, text),
    ...(expected === undefined ? {} : { expected }),
    ...(actual === undefined ? {} : { actual })
  }
}

function relatives(
  data: TracePlayerData,
  command: CommandLog
): Pick<ActionDetail, 'parent' | 'children' | 'omittedChildren'> {
  const { commands } = data.trace
  const parentAt = commands.findIndex(
    (row) => row.id !== undefined && row.id === command.parentId
  )
  const children = commands.flatMap((row, at) =>
    command.id !== undefined && row.parentId === command.id
      ? [actionId(row, at)]
      : []
  )
  const omitted = children.length - MAX_LISTED_CHILDREN
  return {
    ...(parentAt < 0 ? {} : { parent: actionId(commands[parentAt], parentAt) }),
    ...(children.length
      ? { children: children.slice(0, MAX_LISTED_CHILDREN) }
      : {}),
    ...(omitted > 0 ? { omittedChildren: omitted } : {})
  }
}

function sourceOf(
  data: TracePlayerData,
  command: CommandLog,
  cut: DetailCut
): Pick<ActionDetail, 'callSite' | 'source'> {
  if (!command.callSource) {
    return {}
  }
  const source =
    cut.contextLines !== 'none' &&
    sourceAround(
      data.trace.sources,
      command.callSource,
      cut.contextLines,
      Math.min(cut.text, MAX_SOURCE_LINE_CHARS)
    )
  return {
    callSite: clipText(
      command.callSource,
      Math.min(cut.text, MAX_LIST_TEXT_CHARS)
    ),
    ...(source ? { source } : {})
  }
}

function contextLinesOf(options: ActionDetailOptions): number {
  const lines = options.contextLines ?? DEFAULT_SOURCE_CONTEXT_LINES
  if (
    !Number.isInteger(lines) ||
    lines < 0 ||
    lines > MAX_SOURCE_CONTEXT_LINES
  ) {
    throw new Error(
      `contextLines must be an integer from 0 to ${MAX_SOURCE_CONTEXT_LINES}, got ${lines}`
    )
  }
  return lines
}

function detailOf(
  data: TracePlayerData,
  { action, status, test, relatives }: DetailBasis,
  cut: DetailCut
): ActionDetail {
  const { command } = action
  const testPath = test.map((title) =>
    clipText(title, Math.min(cut.text, MAX_TITLE_CHARS))
  )
  const args = command.args.length
    ? clipValue(command.args, cut.text)
    : undefined
  const result = failedAssertion(command)
    ? undefined
    : clipValue(command.result, cut.text)
  const error = errorOf(command, cut.text)
  const listChars = Math.min(cut.text, MAX_LIST_TEXT_CHARS)
  return {
    callId: action.callId,
    title: clipText(command.title ?? command.command, cut.text),
    command: clipText(command.command, cut.text),
    startMs: action.startMs,
    durationMs: action.endMs - action.startMs,
    ...(status === ACTION_STATUS.PASSED ? {} : { status }),
    ...(testPath.length ? { test: testPath } : {}),
    ...relatives,
    ...(command.selector
      ? { selector: clipText(command.selector, listChars) }
      : {}),
    ...(args === undefined ? {} : { args }),
    ...(result === undefined ? {} : { result }),
    ...(error ? { error } : {}),
    ...sourceOf(data, command, cut)
  }
}

// Source lines go first, the call's own line last, all at full text; only then does each field narrow, the order the README gives. The narrowest is returned even when it does not fit.
function cutsFor(contextLines: number): DetailCut[] {
  const [widest, ...narrower] = DETAIL_TEXT_STEPS
  const lines = [...new Set([contextLines, Math.min(contextLines, 1), 0])]
  return [
    ...lines.map((count) => ({ text: widest, contextLines: count })),
    { text: widest, contextLines: 'none' as const },
    ...narrower.map((text) => ({ text, contextLines: 'none' as const }))
  ]
}

/** One action in full: its arguments, result, error with expected and actual, and the test source around its call site, cut to fit `maxChars`. */
export function traceActionDetail(
  handle: TraceHandle,
  callId: string,
  options: ActionDetailOptions = {}
): ActionDetail {
  const budget = queryBudgetOf(options.maxChars)
  const contextLines = contextLinesOf(options)
  const { data } = traceStateOf(handle)
  const action = actionByCallId(data, callId)
  const basis: DetailBasis = {
    action,
    status: actionStatus(action.command, retriedRows(data.trace.commands)),
    test: stepPathOf(data, action.index),
    relatives: relatives(data, action.command)
  }
  let detail: ActionDetail | undefined
  for (const cut of cutsFor(contextLines)) {
    detail = detailOf(data, basis, cut)
    if (JSON.stringify(detail).length <= budget) {
      break
    }
  }
  return detail!
}
