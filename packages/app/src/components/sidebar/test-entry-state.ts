import type {
  SuiteStatsFragment,
  TestStatsFragment
} from '../../controller/types.js'
import { STATE_MAP } from './constants.js'
import { TestState } from './types.js'
import type { TestEntry, TestStatus } from './types.js'

type Fragment = TestStatsFragment | SuiteStatsFragment

/** A suite is "running" when there are pending children + at least one
 *  terminal child, or when the suite itself is marked running with pending
 *  children. Tests fall through to their explicit state. */
export function isRunning(entry: Fragment): boolean {
  if ('tests' in entry) {
    if (
      (entry.tests ?? []).some((t) => t.state === 'running') ||
      (entry.suites ?? []).some((s) => isRunning(s))
    ) {
      return true
    }

    const hasPendingTests = (entry.tests ?? []).some(
      (t) => t.state === 'pending'
    )
    const hasPendingSuites = (entry.suites ?? []).some((s) => hasPending(s))
    const suiteState = entry.state

    if (suiteState === 'running' && (hasPendingTests || hasPendingSuites)) {
      return true
    }

    // Mixed terminal + pending = run in progress regardless of explicit suite
    // state (Nightwatch-Cucumber leaves feature.state undefined in the JSON).
    const allDescendants = [...(entry.tests ?? []), ...(entry.suites ?? [])]
    const hasSomeTerminal = allDescendants.some(
      (t) =>
        t.state === 'passed' || t.state === 'failed' || t.state === 'skipped'
    )
    if ((hasPendingTests || hasPendingSuites) && hasSomeTerminal) {
      return true
    }
    return false
  }
  return entry.state === 'running'
}

export function hasPending(entry: Fragment): boolean {
  if ('tests' in entry) {
    if (entry.state === 'pending') {
      return true
    }
    if ((entry.tests ?? []).some((t) => t.state === 'pending')) {
      return true
    }
    if ((entry.suites ?? []).some((s) => hasPending(s))) {
      return true
    }
    return false
  }
  return entry.state === 'pending'
}

export function hasFailed(entry: Fragment): boolean {
  if ('tests' in entry) {
    if ((entry.tests ?? []).find((t) => t.state === 'failed')) {
      return true
    }
    if ((entry.suites ?? []).some((s) => hasFailed(s))) {
      return true
    }
    return false
  }
  return entry.state === 'failed'
}

export function computeEntryState(entry: Fragment): TestStatus {
  // Suites: check running from children FIRST. A rerun clears end times but
  // not stale 'passed'/'failed' state — show the spinner before falling
  // through to the cached terminal value.
  if ('tests' in entry && isRunning(entry)) {
    return TestState.RUNNING
  }

  const state = entry.state

  // 'pending' on a suite = backend signaling a new run starting. Skip
  // children check; stale terminal children must not flip suite to passed.
  if ('tests' in entry && state === 'pending') {
    return TestState.RUNNING
  }

  // Suite with no explicit terminal state — derive from children. If any
  // child is non-terminal, the run is still in progress.
  if ('tests' in entry && (state === null || state === 'running')) {
    const allDescendants = [...(entry.tests ?? []), ...(entry.suites ?? [])]
    if (allDescendants.length > 0) {
      const allTerminal = allDescendants.every(
        (t) =>
          t.state === 'passed' || t.state === 'failed' || t.state === 'skipped'
      )
      if (!allTerminal) {
        return TestState.RUNNING
      }
    }
  }

  const mappedState = state ? STATE_MAP[state] : undefined
  if (mappedState) {
    return mappedState
  }

  if ('tests' in entry) {
    if (hasFailed(entry)) {
      return TestState.FAILED
    }
    return TestState.PASSED
  }

  // Leaf test: pending → spinner (run is in progress), NOT circle (which
  // would imply "never run").
  if (state === 'pending') {
    return TestState.RUNNING
  }
  return entry.end ? TestState.PASSED : 'pending'
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
  if ('tests' in entry) {
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
