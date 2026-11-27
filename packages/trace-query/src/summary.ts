import {
  deviceLabel,
  retriedRows,
  traceOutcome,
  TRACE_OUTCOME,
  type Metadata,
  type TraceOutcome
} from '@wdio/devtools-shared'
import { actionTree } from './action-list.js'
import { budgetOf, clipText } from './budget.js'
import { MAX_TITLE_CHARS, TRACE_ERROR_KIND } from './constants.js'
import { collectErrors } from './errors.js'
import { traceStateOf } from './open-trace.js'
import { failedBranches, testTree, treeWithin } from './steps.js'
import type {
  PageRequest,
  TestNode,
  TraceError,
  TraceHandle,
  TraceSummary
} from './types.js'

function browserOf(metadata: Metadata): string | undefined {
  const capabilities = metadata.capabilities as
    { browserName?: unknown; browserVersion?: unknown } | undefined
  const name = capabilities?.browserName
  if (typeof name !== 'string' || !name) {
    return undefined
  }
  const version = capabilities?.browserVersion
  const label =
    typeof version === 'string' && version ? `${name} ${version}` : name
  return clipText(label, MAX_TITLE_CHARS)
}

// A failed trace is explained by an action or a step that failed; a console line or request there is a symptom, not the cause.
function firstError(
  errors: readonly TraceError[],
  outcome: TraceOutcome
): TraceError | undefined {
  const of = (kind: TraceError['kind']) =>
    errors.find((error) => error.kind === kind)
  const cause = of(TRACE_ERROR_KIND.ACTION) ?? of(TRACE_ERROR_KIND.STEP)
  return cause ?? (outcome === TRACE_OUTCOME.FAILED ? undefined : errors[0])
}

// The tree is the one part of a summary that grows with the run, so past half the budget only its failed branches stay, as many as fit.
function boundedTests(
  tests: TestNode[],
  budget: number
): Pick<TraceSummary, 'tests' | 'omittedTests'> {
  const half = Math.floor(budget / 2)
  if (JSON.stringify(tests).length <= half) {
    return tests.length ? { tests } : {}
  }
  const failed = failedBranches(tests)
  const { kept, omitted } = treeWithin(failed.kept, half)
  return {
    ...(kept.length ? { tests: kept } : {}),
    omittedTests: failed.omitted + omitted
  }
}

/** What the trace holds and how it went, small enough to read first. */
export function traceSummary(
  handle: TraceHandle,
  request: Pick<PageRequest, 'maxChars'> = {}
): TraceSummary {
  const budget = budgetOf(request.maxChars)
  const { data } = traceStateOf(handle)
  const { metadata, commands } = data.trace
  const errors = collectErrors(data)
  const count = (kind: TraceError['kind']) =>
    errors.filter((error) => error.kind === kind).length
  const outcome = traceOutcome(data)
  const browser = browserOf(metadata)
  const error = firstError(errors, outcome)
  return {
    ...(metadata.runner ? { runner: metadata.runner } : {}),
    ...(browser ? { browser } : {}),
    ...(metadata.device
      ? { device: clipText(deviceLabel(metadata.device), MAX_TITLE_CHARS) }
      : {}),
    durationMs: Math.round(data.duration),
    outcome,
    counts: {
      actions: actionTree(data).length,
      failedActions: count(TRACE_ERROR_KIND.ACTION),
      failedSteps: count(TRACE_ERROR_KIND.STEP),
      consoleErrors: count(TRACE_ERROR_KIND.CONSOLE),
      failedRequests: count(TRACE_ERROR_KIND.REQUEST)
    },
    ...(error ? { firstError: error } : {}),
    ...boundedTests(testTree(data, retriedRows(commands)), budget)
  }
}
