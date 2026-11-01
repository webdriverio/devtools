import type {
  SuiteStatsFragment,
  TestStatsFragment
} from '../../controller/types.js'
import {
  emptyTally,
  tallyOutcomes,
  type GroupOutcome,
  type StateTally
} from '../../utils/test-outcome.js'

/** The card counts states the same way the tree derives them, so the tally is
 *  the shared one under a name the summary reads better with. */
export type SuiteSummary = StateTally
export type RunStatus = GroupOutcome

/**
 * The headline run state shown in the status pill — the same derivation the
 * tree rows use, so a run can never read "Idle" next to a green suite.
 */
export { deriveOutcome as deriveRunStatus } from '../../utils/test-outcome.js'

function collectTests(
  suite: SuiteStatsFragment,
  tests: TestStatsFragment[]
): void {
  for (const test of suite.tests ?? []) {
    if (test) {
      tests.push(test)
    }
  }
  for (const child of suite.suites ?? []) {
    if (child) {
      collectTests(child, tests)
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
  if (!suites) {
    return emptyTally()
  }
  const roots = suites
    .flatMap((chunk) => Object.values(chunk))
    .filter((suite) => suite && !suite.parent)
  const unique = Array.from(
    new Map(roots.map((suite) => [suite.uid, suite])).values()
  )
  const tests: TestStatsFragment[] = []
  for (const suite of unique) {
    collectTests(suite, tests)
  }
  return tallyOutcomes(tests)
}
