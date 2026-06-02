import { getTimestamp } from '../utils/helpers.js'
import type { SuiteStatsFragment, TestStatsFragment } from './types.js'

/**
 * Pure suite-tree merge logic, lifted out of DataManagerController to keep it
 * testable and to drop ~280 lines from the controller class. The functions
 * take rerun-state explicitly via {@link MergeContext} so they don't depend on
 * module-level mutable state.
 */
export interface MergeContext {
  /** Set during a single-test rerun — siblings should stay frozen at their
   *  pre-rerun state. */
  activeRerunTestUid?: string
  /** Set during a feature/scenario rerun — used to detect "child rerun" so
   *  sibling scenarios under the same feature aren't optimistically flipped
   *  back to 'pending' when the feature suite re-emits with state='pending'. */
  activeRerunSuiteUid?: string
}

/**
 * Stable identity key for a test/suite that survives reporter UID drift
 * across reruns. The reporter's signature counter can reassign UIDs when a
 * single scenario is rerun (e.g. Cucumber outline example 2 reruns alone and
 * gets the UID example 1 originally had). Matching by (file + featureLine +
 * fullTitle) lets the merge dedupe by stable identity instead of the unstable
 * uid.
 */
export function canonicalKey(
  item: TestStatsFragment | SuiteStatsFragment
): string | undefined {
  const file = item.file ?? ''
  const featureFile = item.featureFile ?? ''
  const featureLine = item.featureLine ?? ''
  const fullTitle = item.fullTitle ?? item.title ?? ''
  if (!file && !featureFile && !fullTitle) {
    return undefined
  }
  return `${file}::${featureFile}:${featureLine}::${fullTitle}`
}

/**
 * Rewrite each incoming item's uid to the matching existing entry's uid when
 * their canonical keys match. Lets rerun payloads merge into the original
 * rows even if the reporter assigned a different uid this time around.
 */
export function canonicalizeUids<
  T extends TestStatsFragment | SuiteStatsFragment
>(prev: T[], next: T[]): T[] {
  if (!next.length || !prev.length) {
    return next
  }
  const canonicalToUid = new Map<string, string>()
  for (const item of prev) {
    if (!item) {
      continue
    }
    const key = canonicalKey(item)
    if (key && !canonicalToUid.has(key)) {
      canonicalToUid.set(key, item.uid)
    }
  }
  return next.map((item) => {
    if (!item) {
      return item
    }
    const key = canonicalKey(item)
    if (!key) {
      return item
    }
    const stableUid = canonicalToUid.get(key)
    if (stableUid && stableUid !== item.uid) {
      return { ...item, uid: stableUid }
    }
    return item
  })
}

export function mergeTests(
  prev: TestStatsFragment[] = [],
  next: TestStatsFragment[] = [],
  ctx: MergeContext
): TestStatsFragment[] {
  const map = new Map<string, TestStatsFragment>()
  prev?.forEach((test) => test && map.set(test.uid, test))

  const canonicalizedNext = canonicalizeUids(prev || [], next || [])

  canonicalizedNext.forEach((test) => {
    if (!test) {
      return
    }
    const existing = map.get(test.uid)
    const activeTargetUid = ctx.activeRerunTestUid

    // During a single-test rerun, keep all sibling tests frozen exactly as
    // they were before the rerun started. The backend can still emit suite-
    // wide updates for those siblings, but the UI should only change the
    // targeted test and its parent suite state.
    if (activeTargetUid && test.uid !== activeTargetUid && existing) {
      map.set(test.uid, { ...existing })
      return
    }

    // Check if this test is a rerun (different start time)
    const isRerun =
      existing &&
      test.start &&
      existing.start &&
      getTimestamp(test.start) !== getTimestamp(existing.start)

    if (activeTargetUid && isRerun && test.state === 'pending' && existing) {
      // The incoming suite structure marks all tests as "pending" at start.
      // Preserve the ENTIRE existing record (including its old start time) so
      // that tests not part of the current rerun keep their previous results.
      // Crucially, keeping `existing.start` (the old run's timestamp) means
      // every subsequent update for this test during the new run still has a
      // different start time and therefore continues to be detected as a
      // rerun — preventing a later normal-merge from overwriting state/end.
      // When the test actually starts executing its state changes to "running"
      // (non-pending), which falls through to the replace branch below.
      map.set(test.uid, { ...existing })
      return
    }

    // Replace on rerun (non-pending incoming), merge on normal update
    map.set(
      test.uid,
      isRerun ? test : existing ? { ...existing, ...test } : test
    )
  })

  return Array.from(map.values())
}

export function mergeChildSuites(
  prev: SuiteStatsFragment[] = [],
  next: SuiteStatsFragment[] = [],
  ctx: MergeContext
): SuiteStatsFragment[] {
  const map = new Map<string, SuiteStatsFragment>()
  prev?.forEach((suite) => suite && map.set(suite.uid, suite))

  const canonicalizedNext = canonicalizeUids(prev || [], next || [])

  canonicalizedNext.forEach((suite) => {
    if (!suite) {
      return
    }
    const existing = map.get(suite.uid)
    map.set(suite.uid, existing ? mergeSuite(existing, suite, ctx) : suite)
  })

  return Array.from(map.values())
}

interface ChildStateSummary {
  hasInProgressChildren: boolean
  hasFailedChildren: boolean
  allChildrenTerminal: boolean
}

function summarizeChildStates(
  mergedTests: SuiteStatsFragment['tests'] | undefined,
  mergedSuites: SuiteStatsFragment['suites'] | undefined
): ChildStateSummary {
  const allChildren = [...(mergedTests || []), ...(mergedSuites || [])]
  // undefined/null state counts as in-progress so we don't derive 'passed'
  // before children have reported.
  const hasInProgressChildren = allChildren.some(
    (child) =>
      child?.state === 'running' ||
      child?.state === 'pending' ||
      child?.state === null
  )
  const hasFailedChildren = allChildren.some(
    (child) => child?.state === 'failed'
  )
  const hasChildren = allChildren.length > 0
  const allChildrenTerminal =
    hasChildren &&
    allChildren.every(
      (child) =>
        child?.state === 'passed' ||
        child?.state === 'failed' ||
        child?.state === 'skipped'
    )
  return { hasInProgressChildren, hasFailedChildren, allChildrenTerminal }
}

// When a new run starts the backend sends the feature suite with
// state: 'pending' before it has pushed any scenario children. Stale child
// suites preserved by mergeChildSuites must not keep their terminal states —
// mark them 'pending' so they render as a spinner instead of a stale check.
// Exception: child-scope rerun (activeRerunSuiteUid differs from the
// incoming feature suite's uid) — sibling scenarios keep terminal states.
function resetStaleChildrenOnRerun(
  mergedSuites: SuiteStatsFragment['suites'] | undefined,
  incoming: SuiteStatsFragment,
  ctx: MergeContext
): SuiteStatsFragment['suites'] | undefined {
  const isChildRerun =
    !!ctx.activeRerunSuiteUid && ctx.activeRerunSuiteUid !== incoming.uid
  if (incoming.state !== 'pending' || !mergedSuites || isChildRerun) {
    return mergedSuites
  }
  return mergedSuites.map((s) =>
    s.state === 'passed' || s.state === 'failed'
      ? { ...s, state: 'pending' as const, end: undefined }
      : s
  )
}

export function mergeSuite(
  existing: SuiteStatsFragment,
  incoming: SuiteStatsFragment,
  ctx: MergeContext
): SuiteStatsFragment {
  const mergedTests = mergeTests(existing.tests, incoming.tests, ctx)
  const mergedSuites = mergeChildSuites(existing.suites, incoming.suites, ctx)

  // Strip nullish state from incoming so it doesn't overwrite a valid existing
  // state. Nightwatch reporter may omit state fields entirely.
  const { tests, suites, ...incomingProps } = incoming
  void tests
  void suites
  if (incomingProps.state === undefined || incomingProps.state === null) {
    delete (incomingProps as Partial<SuiteStatsFragment>).state
  }

  // WDIO SuiteStats never carries 'state' on suite end → treat
  // undefined/null/pending the same.
  const incomingStateIsPendingOrUnset =
    incoming.state === 'pending' ||
    incoming.state === null ||
    incoming.state === undefined
  const incomingStateIsUnset =
    incoming.state === null || incoming.state === undefined

  const { hasInProgressChildren, hasFailedChildren, allChildrenTerminal } =
    summarizeChildStates(mergedTests, mergedSuites)

  // Keep 'running' when the backend hasn't reported a terminal state and any
  // child is still in flight — covers both Nightwatch (was 'running') and
  // WDIO (was 'passed' from previous run, now has new running children).
  const keepRunningState =
    incomingStateIsPendingOrUnset && hasInProgressChildren

  // Only derive a terminal state when the backend left it unset AND every
  // child has settled. Avoids deriving 'passed' from stale previous-run kids.
  const derivedCompletedState: SuiteStatsFragment['state'] | undefined =
    allChildrenTerminal && incomingStateIsUnset
      ? hasFailedChildren
        ? 'failed'
        : 'passed'
      : undefined

  const finalSuites = resetStaleChildrenOnRerun(mergedSuites, incoming, ctx)

  return {
    ...existing,
    ...incomingProps,
    ...(keepRunningState && hasInProgressChildren
      ? { state: 'running' as const }
      : incomingStateIsPendingOrUnset &&
          !hasInProgressChildren &&
          derivedCompletedState
        ? { state: derivedCompletedState }
        : {}),
    tests: mergedTests,
    suites: finalSuites
  }
}
