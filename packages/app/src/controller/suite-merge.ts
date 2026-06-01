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

export function mergeSuite(
  existing: SuiteStatsFragment,
  incoming: SuiteStatsFragment,
  ctx: MergeContext
): SuiteStatsFragment {
  // First merge tests and suites properly
  const mergedTests = mergeTests(existing.tests, incoming.tests, ctx)
  const mergedSuites = mergeChildSuites(existing.suites, incoming.suites, ctx)

  // Then merge suite properties, ensuring merged tests/suites are preserved
  const { tests, suites, ...incomingProps } = incoming
  void tests
  void suites

  // Strip undefined state from incoming so it doesn't overwrite a valid existing state.
  // The Nightwatch reporter may send suites without a state field when the JSON
  // serialization omits properties that are undefined on the object.
  if (incomingProps.state === undefined || incomingProps.state === null) {
    delete (incomingProps as Partial<SuiteStatsFragment>).state
  }

  // Treat incoming state=undefined/null the same as pending — WDIO's SuiteStats
  // doesn't set 'state' on suite end (unlike TestStats), so undefined means the
  // backend hasn't assigned a terminal state. Null is the Nightwatch equivalent.
  const incomingStateIsPendingOrUnset =
    incoming.state === 'pending' ||
    incoming.state === null ||
    incoming.state === undefined

  const allChildren = [...(mergedTests || []), ...(mergedSuites || [])]
  // Treat children with undefined/null state as in-progress (not yet terminal).
  // This prevents prematurely deriving 'passed' when children haven't reported yet.
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

  // Only derive 'passed' when ALL children have reached a terminal state.
  const allChildrenTerminal =
    hasChildren &&
    allChildren.every(
      (child) =>
        child?.state === 'passed' ||
        child?.state === 'failed' ||
        child?.state === 'skipped'
    )

  // On rerun start we optimistically mark the suite as running in the UI.
  // Keep (or set) running state whenever the incoming state is unset/pending
  // AND children are still in-progress. This handles both:
  //   • Nightwatch: suite was already 'running' → keep it running
  //   • WDIO: suite was 'passed' from previous run but now has running children
  //     (WDIO SuiteStats never carries an explicit state, so the previous
  //     derivedCompletedState='passed' would otherwise be silently preserved)
  const keepRunningState =
    incomingStateIsPendingOrUnset && hasInProgressChildren

  // Only derive 'passed'/'failed' from children when the backend hasn't
  // assigned an explicit state (WDIO case: SuiteStats.state is never set on
  // suite end). When state is explicitly 'pending' the backend is signalling
  // a new run is starting — stale children from the previous run must not
  // be used to derive a completed state.
  const incomingStateIsUnset =
    incoming.state === null || incoming.state === undefined

  const derivedCompletedState: SuiteStatsFragment['state'] | undefined =
    allChildrenTerminal && incomingStateIsUnset
      ? hasFailedChildren
        ? 'failed'
        : 'passed'
      : undefined

  // When a new run starts the backend sends the feature suite with
  // state: 'pending' before it has pushed any scenario children.
  // mergeChildSuites preserves stale child suites from the previous run,
  // but they must not keep their terminal states — mark them 'pending' so
  // they render as a spinner instead of a stale checkmark/cross.
  // Exception: when only a specific child scenario is being rerun
  // (activeRerunSuiteUid differs from the incoming feature suite's uid),
  // sibling scenarios must keep their existing terminal states.
  const isChildRerun =
    !!ctx.activeRerunSuiteUid && ctx.activeRerunSuiteUid !== incoming.uid
  const finalSuites =
    incoming.state === 'pending' && mergedSuites && !isChildRerun
      ? mergedSuites.map((s) =>
          s.state === 'passed' || s.state === 'failed'
            ? { ...s, state: 'pending' as const, end: undefined }
            : s
        )
      : mergedSuites

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
