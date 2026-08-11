import type {
  SuiteStatsFragment,
  TestStatsFragment
} from '../../controller/types.js'
import {
  OUTCOME,
  deriveEntryOutcome,
  isSuiteEntry,
  type EntryOutcome
} from '../../utils/test-outcome.js'
import { TestState } from './types.js'
import type { TestEntry, TestStatus } from './types.js'

type Fragment = TestStatsFragment | SuiteStatsFragment

/** Narrowing wrapper over the shared predicate so the tree keeps one rule for
 *  "is this a suite?". */
function isSuiteFragment(entry: Fragment): entry is SuiteStatsFragment {
  return isSuiteEntry(entry)
}

/** How an outcome renders in the tree: a queued entry spins because the run
 *  reached it, and an entry nothing has reported on shows the not-run circle
 *  rather than a green check. */
const OUTCOME_STATE: Record<EntryOutcome, TestStatus> = {
  [OUTCOME.PASSED]: TestState.PASSED,
  [OUTCOME.FAILED]: TestState.FAILED,
  [OUTCOME.SKIPPED]: TestState.SKIPPED,
  [OUTCOME.RUNNING]: TestState.RUNNING,
  [OUTCOME.QUEUED]: TestState.RUNNING,
  [OUTCOME.IDLE]: TestState.PENDING
}

export function computeEntryState(entry: Fragment): TestStatus {
  return OUTCOME_STATE[deriveEntryOutcome(entry)]
}

/**
 * Map a raw suite/test fragment to the sidebar's `TestEntry` shape.
 * `filterEntry` is passed in because it depends on component-level filter
 * state — the sidebar holds the active filter and decides which children
 * stay visible.
 */
export function getTestEntry(
  entry: Fragment,
  filterEntry: (entry: TestEntry) => boolean
): TestEntry {
  if (isSuiteFragment(entry)) {
    const entries = [...(entry.tests ?? []), ...(entry.suites ?? [])]
    // A suite whose children are themselves suites is a feature/file-level
    // container (Cucumber feature or test file). Tag it as 'feature' so the
    // backend runner can distinguish it from a scenario/spec-level suite and
    // avoid applying a --name filter that would match no scenarios.
    const hasChildSuites = entry.suites && entry.suites.length > 0
    const derivedType = hasChildSuites ? 'feature' : entry.type || 'suite'
    return {
      uid: entry.uid,
      label: entry.title ?? '',
      type: 'suite',
      state: computeEntryState(entry),
      callSource: entry.callSource,
      specFile: entry.file,
      fullTitle: entry.title ?? '',
      featureFile: entry.featureFile,
      featureLine: entry.featureLine,
      suiteType: derivedType,
      children: Object.values(entries)
        .map((e) => getTestEntry(e, filterEntry))
        .filter(filterEntry)
    }
  }
  return {
    uid: entry.uid,
    label: entry.title ?? '',
    type: 'test',
    state: computeEntryState(entry),
    callSource: entry.callSource,
    specFile: entry.file,
    fullTitle: entry.fullTitle || entry.title,
    featureFile: entry.featureFile,
    featureLine: entry.featureLine,
    children: []
  }
}
