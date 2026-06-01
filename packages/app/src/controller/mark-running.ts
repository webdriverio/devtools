import type {
  SuiteStatsFragment,
  TestStatsFragment
} from './types.js'

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

        const markAsRunning = (
          s: SuiteStatsFragment
        ): { suite: SuiteStatsFragment; matched: boolean } => {
          const runStart = new Date()

          if (entryType !== 'test' && s.uid === uid) {
            const markSuiteTreeAsRunning = (
              suiteNode: SuiteStatsFragment
            ): SuiteStatsFragment => ({
              ...suiteNode,
              state: 'running',
              start: runStart,
              end: undefined,
              tests: [] as TestStatsFragment[],
              suites: suiteNode.suites?.map(markSuiteTreeAsRunning) || []
            })
            return { matched: true, suite: markSuiteTreeAsRunning(s) }
          }

          let matched = false
          const updatedTests = (s.tests?.map((test) => {
            if (test.uid === uid) {
              matched = true
              return {
                ...test,
                state: 'pending',
                start: new Date(),
                end: undefined
              }
            }
            return test
          }) ?? []) as TestStatsFragment[]

          const updatedNestedSuites =
            s.suites?.map((nestedSuite) => {
              const nestedResult = markAsRunning(nestedSuite)
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
                    // Preserve parent's start/end if already running —
                    // subsequent child-scenario marks would otherwise reset
                    // the feature's original run timestamp.
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

        updatedChunk[suiteUid] = markAsRunning(suite).suite
      }
    )
    return updatedChunk
  })
}
