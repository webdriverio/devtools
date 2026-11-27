import type { ConsoleLog } from '@wdio/devtools-shared'
import { rangeAround } from './action-window.js'
import { sinceStart } from './actions.js'
import {
  fitted,
  itemBudgetBeside,
  pageWith,
  positiveInteger,
  queryBudgetOf
} from './budget.js'
import { consoleText } from './console-text.js'
import {
  DEFAULT_CONSOLE_LEVELS,
  DEFAULT_CONSOLE_LINE_CHARS,
  PAGE_SCOPE
} from './constants.js'
import { allows, countBy, sortedFilter } from './listing-filters.js'
import { traceStateOf, type TraceState } from './open-trace.js'
import { ownLevel, ownSource } from './own-unions.js'
import { returnedText } from './returned-text.js'
import type {
  ConsoleLine,
  ConsolePage,
  ConsoleQuery,
  TraceHandle
} from './types.js'

function toLine(
  state: TraceState,
  log: ConsoleLog,
  text: string,
  maxChars: number
): ConsoleLine {
  const source = log.source === undefined ? undefined : ownSource(log.source)
  return {
    timeMs: sinceStart(state.data, log.timestamp),
    level: ownLevel(log.type),
    ...(source ? { source } : {}),
    text: returnedText(text, { state, kind: 'console', maxChars })
  }
}

function matchingLines(state: TraceState, query: ConsoleQuery) {
  const range = rangeAround(state.data, query)
  const needle = query.text?.toLowerCase()
  return state.data.trace.consoleLogs
    .filter(
      (log) =>
        !range || (log.timestamp >= range.from && log.timestamp <= range.to)
    )
    .filter(
      (log) =>
        !query.sources?.length ||
        (log.source !== undefined && allows(query.sources, log.source))
    )
    .map((log) => ({ log, text: consoleText(log) }))
    .filter(({ text }) => !needle || text.toLowerCase().includes(needle))
}

/** Console and stdio lines in time order, filtered by level (errors unless asked), source, text and the time around an action. */
export function traceConsole(
  handle: TraceHandle,
  query: ConsoleQuery = {}
): ConsolePage {
  queryBudgetOf(query.maxChars)
  const state = traceStateOf(handle)
  const maxLineChars = positiveInteger(
    'maxLineChars',
    query.maxLineChars ?? DEFAULT_CONSOLE_LINE_CHARS
  )
  const levels = query.levels ?? DEFAULT_CONSOLE_LEVELS
  const matched = matchingLines(state, query)
  const extra = { byLevel: countBy(matched, ({ log }) => ownLevel(log.type)) }
  const kept = matched.filter(({ log }) => allows(levels, ownLevel(log.type)))
  const scope = JSON.stringify([
    PAGE_SCOPE.CONSOLE,
    sortedFilter(levels),
    sortedFilter(query.sources),
    query.text,
    query.action,
    query.windowMs,
    maxLineChars
  ])
  const budget = itemBudgetBeside(kept.length, query, scope, extra)
  const lines = kept.map(({ log, text }) =>
    fitted(
      (maxChars) => toLine(state, log, text, maxChars),
      maxLineChars,
      budget
    )
  )
  return pageWith(lines, query, { scope }, extra)
}
