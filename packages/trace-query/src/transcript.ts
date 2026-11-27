import { clipText, itemBudget, pageOf, queryBudgetOf } from './budget.js'
import { PAGE_SCOPE } from './constants.js'
import { traceStateOf } from './open-trace.js'
import type { Page, PageRequest, TraceHandle } from './types.js'

// A page always holds one line, so a line is cut until its JSON form, quotes and escapes included, fits the page.
function lineWithin(line: string, budget: number): string {
  let max = budget
  let cut = line
  while (JSON.stringify(cut).length > budget && max > 1) {
    max = Math.max(1, max - (JSON.stringify(cut).length - budget))
    cut = clipText(line, max)
  }
  return cut
}

/** The zip's `transcript.md` a page of lines at a time; undefined when the zip carries none. */
export function traceTranscript(
  handle: TraceHandle,
  request: PageRequest = {}
): Page<string> | undefined {
  queryBudgetOf(request.maxChars)
  const { transcript } = traceStateOf(handle).data
  if (transcript === undefined) {
    return undefined
  }
  const lines = transcript.split('\n')
  const budget = Math.max(
    1,
    itemBudget(lines.length, request.maxChars, PAGE_SCOPE.TRANSCRIPT)
  )
  return pageOf(
    lines.map((line) => lineWithin(line, budget)),
    request,
    { scope: PAGE_SCOPE.TRANSCRIPT }
  )
}
