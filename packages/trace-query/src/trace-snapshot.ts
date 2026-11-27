import {
  isSnapshotHeaderLine,
  type TraceSnapshotSource
} from '@wdio/devtools-shared'
import { actionByCallId } from './actions.js'
import { fitted, itemBudgetBeside, pageWith, queryBudgetOf } from './budget.js'
import { captureSource, snapshotSourceOf } from './capture-source.js'
import {
  MAX_SNAPSHOT_HEADER_CHARS,
  MAX_SNAPSHOT_LINE_CHARS,
  MAX_TITLE_CHARS,
  PAGE_SCOPE
} from './constants.js'
import { traceStateOf, type TraceState } from './open-trace.js'
import { returnedText } from './returned-text.js'
import { scopeSnapshot } from './snapshot-scope.js'
import type {
  TraceHandle,
  TraceSnapshot,
  TraceSnapshotRequest
} from './types.js'

function pageText(state: TraceState, text: string, maxChars: number): string {
  return returnedText(text, { state, kind: 'accessibility-tree', maxChars })
}

interface BesideLines {
  state: TraceState
  callId: string
  source: TraceSnapshotSource
  header?: string
  matches?: number
}

/** The fields beside a page's lines, the header and the capture's title cut to `maxChars`. */
function besideLines(beside: BesideLines, maxChars: number) {
  const { state, callId, source, header, matches } = beside
  return {
    callId,
    capture: captureSource(
      state.data,
      callId,
      source.timestamp,
      source.ownerCallId,
      Math.min(MAX_TITLE_CHARS, maxChars)
    ),
    ...(header === undefined
      ? {}
      : {
          header: pageText(
            state,
            header,
            Math.min(MAX_SNAPSHOT_HEADER_CHARS, maxChars)
          )
        }),
    ...(matches === undefined ? {} : { matches })
  }
}

/** The accessibility tree, with locators, at an action, its node lines paged within the budget; undefined when the trace holds no capture at or before it. */
export function traceSnapshot(
  handle: TraceHandle,
  callId: string,
  request: TraceSnapshotRequest = {}
): TraceSnapshot | undefined {
  const budget = queryBudgetOf(request.maxChars)
  const state = traceStateOf(handle)
  const { command } = actionByCallId(state.data, callId)
  const source = snapshotSourceOf(state.data, callId)
  if (!command.snapshotText || !source) {
    return undefined
  }
  const [first = ''] = command.snapshotText.split('\n', 1)
  const scoped = scopeSnapshot(command.snapshotText, request)
  const beside = {
    state,
    callId,
    source,
    ...(isSnapshotHeaderLine(first) ? { header: first } : {}),
    matches: scoped.matches
  }
  // Half the page is left for lines, so one line cut to the floor still fits beside an escape-heavy header.
  const extra = fitted(
    (maxChars) => besideLines(beside, maxChars),
    MAX_SNAPSHOT_HEADER_CHARS,
    Math.floor(budget / 2),
    1
  )
  const scope = JSON.stringify([
    PAGE_SCOPE.SNAPSHOT,
    callId,
    request.locator,
    request.text
  ])
  const lineBudget = itemBudgetBeside(
    scoped.lines.length,
    request,
    scope,
    extra
  )
  const lines = scoped.lines.map((line) =>
    fitted(
      (maxChars) => pageText(state, line, maxChars),
      MAX_SNAPSHOT_LINE_CHARS,
      lineBudget
    )
  )
  return pageWith(lines, request, { scope }, extra)
}
