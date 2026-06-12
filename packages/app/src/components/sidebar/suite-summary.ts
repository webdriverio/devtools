import type {
  SuiteStatsFragment,
  TestStatsFragment
} from '../../controller/types.js'
import { TestState } from './types.js'

export interface SuiteSummary {
  passed: number
  failed: number
  running: number
  skipped: number
  pending: number
  total: number
}

export type RunStatus = 'running' | 'failed' | 'passed' | 'idle'

const emptySummary = (): SuiteSummary => ({
  passed: 0,
  failed: 0,
  running: 0,
  skipped: 0,
  pending: 0,
  total: 0
})

function tally(test: TestStatsFragment, summary: SuiteSummary): void {
  summary.total += 1
  switch (test.state) {
    case TestState.PASSED:
      summary.passed += 1
      break
    case TestState.FAILED:
      summary.failed += 1
      break
    case TestState.RUNNING:
      summary.running += 1
      break
    case TestState.SKIPPED:
      summary.skipped += 1
      break
    default:
      summary.pending += 1
  }
}

function walk(suite: SuiteStatsFragment, summary: SuiteSummary): void {
  for (const test of suite.tests ?? []) {
    if (test) {
      tally(test, summary)
    }
  }
  for (const child of suite.suites ?? []) {
    if (child) {
      walk(child, summary)
    }
  }
}

/**
 * Count leaf tests by state across the suite tree. Roots are deduped by uid
 * the same way the explorer renders them — nested suites carry a `parent` and
 * are reached via recursion, so counting only roots avoids double-counting the
 * flat registry entries.
 */
export function computeSuiteSummary(
  suites: Record<string, SuiteStatsFragment>[] | undefined
): SuiteSummary {
  const summary = emptySummary()
  if (!suites) {
    return summary
  }
  const roots = suites
    .flatMap((chunk) => Object.values(chunk))
    .filter((suite) => suite && !suite.parent)
  const unique = Array.from(
    new Map(roots.map((suite) => [suite.uid, suite])).values()
  )
  for (const suite of unique) {
    walk(suite, summary)
  }
  return summary
}

/**
 * The headline run state shown in the status pill. Running wins over a stale
 * terminal count (a rerun leaves old passed/failed values until results
 * arrive); a finished run is failed if any test failed, otherwise passed.
 */
export function deriveRunStatus(summary: SuiteSummary): RunStatus {
  const terminal = summary.passed + summary.failed + summary.skipped
  if (summary.total === 0) {
    return 'idle'
  }
  if (summary.running > 0 || (summary.pending > 0 && terminal > 0)) {
    return 'running'
  }
  if (summary.failed > 0) {
    return 'failed'
  }
  if (terminal === 0) {
    return 'idle'
  }
  return 'passed'
}
