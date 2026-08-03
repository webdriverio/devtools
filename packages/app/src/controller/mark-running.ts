import { TEST_STATE } from '@wdio/devtools-shared'

import {
  hasFailure,
  hasInFlight,
  isInFlight,
  tallyOutcomes
} from '../utils/test-outcome.js'
import type { SuiteStatsFragment, TestStatsFragment } from './types.js'

/**
 * Pure tree transforms that mark a suite/test as "running" on rerun start.
 * Lifted out of DataManagerController so they're testable and the controller
 * method stays a thin wrapper around the context-provider read/write.
 */

type SuiteChunks = Array<Record<string, SuiteStatsFragment>>

/**
 * Mark every suite (and its descendants) as running. Used when the user
 * clicks the global "TESTS" rerun (uid='*'). Leaf-level tests are cleared so
 * stale step entries from a previous run don't linger; the new run will
 * repopulate them. Child suites are preserved so the tree structure stays
 * visible during the rerun.
 */
export function markAllRunning(suites: SuiteChunks): SuiteChunks {
  const markAllAsRunning = (s: SuiteStatsFragment): SuiteStatsFragment => ({
    ...s,
    state: 'running',
    start: new Date(),
    end: undefined,
    tests: [] as TestStatsFragment[],
    suites: s.suites?.map(markAllAsRunning) || []
  })

  return suites.map((chunk) => {
    const updatedChunk: Record<string, SuiteStatsFragment> = {}
    Object.entries(chunk as Record<string, SuiteStatsFragment>).forEach(
      ([suiteUid, suite]) => {
        if (!suite) {
          updatedChunk[suiteUid] = suite
          return
        }
        updatedChunk[suiteUid] = markAllAsRunning(suite)
      }
    )
    return updatedChunk
  })
}

/**
 * Mark a specific suite OR test as running by walking the tree:
 *  - When `entryType !== 'test'` and a suite matches by uid, mark that suite
 *    AND ALL its descendants as running (full feature/scenario rerun).
 *  - When `entryType === 'test'` and a test matches by uid, mark just that
 *    test pending (start=now, end=undefined). Parent suites get state:
 *    'running' marked on the matched path but their start/end are preserved
 *    if already running so re-clicking a child doesn't reset the feature's
 *    run timestamp.
 */
function markSuiteTreeAsRunning(
  suiteNode: SuiteStatsFragment,
  runStart: Date
): SuiteStatsFragment {
  return {
    ...suiteNode,
    state: 'running',
    start: runStart,
    end: undefined,
    tests: [] as TestStatsFragment[],
    suites:
      suiteNode.suites?.map((s) => markSuiteTreeAsRunning(s, runStart)) || []
  }
}

function markSuiteWithUid(
  s: SuiteStatsFragment,
  uid: string,
  entryType: 'suite' | 'test' | undefined,
  runStart: Date
): { suite: SuiteStatsFragment; matched: boolean } {
  if (entryType !== 'test' && s.uid === uid) {
    return { matched: true, suite: markSuiteTreeAsRunning(s, runStart) }
  }
  let matched = false
  const updatedTests = (s.tests?.map((test) => {
    if (test.uid === uid) {
      matched = true
      return { ...test, state: 'pending', start: new Date(), end: undefined }
    }
    return test
  }) ?? []) as TestStatsFragment[]
  const updatedNestedSuites =
    s.suites?.map((nestedSuite) => {
      const nestedResult = markSuiteWithUid(
        nestedSuite,
        uid,
        entryType,
        runStart
      )
      if (nestedResult.matched) {
        matched = true
      }
      return nestedResult.suite
    }) || []
  return {
    matched,
    suite: {
      ...s,
      ...(matched
        ? {
            state: 'running' as const,
            // Preserve parent's start/end if already running — subsequent
            // child-scenario marks would otherwise reset the feature's
            // original run timestamp.
            ...(s.state !== 'running'
              ? { start: runStart, end: undefined }
              : {})
          }
        : {}),
      tests: updatedTests || [],
      suites: updatedNestedSuites
    }
  }
}

export function markSpecificRunning(
  suites: SuiteChunks,
  uid: string,
  entryType: 'suite' | 'test' | undefined
): SuiteChunks {
  return suites.map((chunk) => {
    const updatedChunk: Record<string, SuiteStatsFragment> = {}
    Object.entries(chunk as Record<string, SuiteStatsFragment>).forEach(
      ([suiteUid, suite]) => {
        if (!suite) {
          updatedChunk[suiteUid] = suite
          return
        }
        const runStart = new Date()
        updatedChunk[suiteUid] = markSuiteWithUid(
          suite,
          uid,
          entryType,
          runStart
        ).suite
      }
    )
    return updatedChunk
  })
}

/** A test the run never settled is cancelled by the stop; one that already
 *  reported an outcome keeps it. */
const stopTest = (test: TestStatsFragment): TestStatsFragment =>
  test && isInFlight(test)
    ? {
        ...test,
        end: new Date(),
        state: TEST_STATE.FAILED,
        error: { message: 'Test execution stopped', name: 'TestStoppedError' }
      }
    : test

/**
 * Mark every test the run never settled as failed. Used when the user manually
 * stops the run from the dashboard — without this, suites with
 * `state: 'running'` would keep showing their spinner indefinitely. A test that
 * already reported an outcome keeps it: a skipped test carries no `end` stamp,
 * so keying the flip off `end` used to relabel every skipped test as failed.
 *
 * The suite's state is derived from its updated children: if any child failed
 * (or the suite itself was 'running' with no live children left), the suite
 * ends up failed — a stopped run is not a passing one. Otherwise the existing
 * state is preserved.
 */
export function markRunningAsStopped(suites: SuiteChunks): SuiteChunks {
  const updateSuite = (s: SuiteStatsFragment): SuiteStatsFragment => {
    const updatedTests = s.tests?.map(stopTest)
    const updatedNestedSuites = s.suites?.map(updateSuite)

    const childStates = tallyOutcomes([
      ...(updatedTests || []),
      ...(updatedNestedSuites || [])
    ])
    const stillRunning = hasInFlight(childStates)
    const derivedState: SuiteStatsFragment['state'] = stillRunning
      ? s.state
      : hasFailure(childStates)
        ? TEST_STATE.FAILED
        : s.state === TEST_STATE.RUNNING
          ? TEST_STATE.FAILED
          : s.state

    return {
      ...s,
      state: derivedState,
      ...(!stillRunning && !s.end ? { end: new Date() } : {}),
      tests: updatedTests || [],
      suites: updatedNestedSuites || []
    }
  }

  return suites.map((chunk) => {
    const updatedChunk: Record<string, SuiteStatsFragment> = {}
    Object.entries(chunk as Record<string, SuiteStatsFragment>).forEach(
      ([uid, suite]) => {
        if (!suite) {
          updatedChunk[uid] = suite
          return
        }
        updatedChunk[uid] = updateSuite(suite)
      }
    )
    return updatedChunk
  })
}
