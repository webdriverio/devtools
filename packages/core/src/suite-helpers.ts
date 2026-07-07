import type {
  SuiteStats,
  TestAncestor,
  TestMetadataMap,
  TestStats,
  TestStatus
} from '@wdio/devtools-shared'
import { TEST_STATE } from '@wdio/devtools-shared'

/**
 * Pure factories + state computations shared by the per-adapter SuiteManager
 * and TestManager classes. Pattern A from CLAUDE.md §the-four-patterns —
 * stateless helpers each adapter calls; no base class because storage
 * strategy differs (selenium uses a single root suite + optional Cucumber
 * sub-suites; nightwatch uses a Map keyed by test file).
 */

export interface SuiteStatsInit {
  uid: string
  title: string
  file: string
  cid?: string
  callSource?: string
  featureFile?: string
  parent?: string
  start?: Date
  state?: TestStatus
}

export interface TestStatsInit {
  uid: string
  title: string
  file: string
  parent: string
  cid?: string
  fullTitle?: string
  callSource?: string
  state?: TestStatus
  start?: Date
}

/**
 * Build a SuiteStats with the standard defaults (empty children arrays,
 * RUNNING state, fresh start time). Adapters override fields as needed
 * before/after the call.
 */
export function createSuiteStats(init: SuiteStatsInit): SuiteStats {
  return {
    uid: init.uid,
    cid: init.cid ?? '0-0',
    title: init.title,
    fullTitle: init.title,
    file: init.file,
    type: 'suite',
    start: init.start ?? new Date(),
    state: init.state ?? TEST_STATE.RUNNING,
    end: null,
    tests: [],
    suites: [],
    hooks: [],
    _duration: 0,
    callSource: init.callSource,
    featureFile: init.featureFile,
    parent: init.parent
  }
}

/** Build a TestStats with the standard defaults. */
export function createTestStats(init: TestStatsInit): TestStats {
  return {
    uid: init.uid,
    cid: init.cid ?? '0-0',
    title: init.title,
    fullTitle: init.fullTitle ?? init.title,
    parent: init.parent,
    state: init.state ?? TEST_STATE.RUNNING,
    start: init.start ?? new Date(),
    end: null,
    type: 'test',
    file: init.file,
    retries: 0,
    _duration: 0,
    hooks: [],
    callSource: init.callSource
  }
}

/**
 * "Permissive" finalize: any failed child → FAILED, otherwise PASSED.
 * Matches selenium's policy — RUNNING tests don't fail the suite.
 */
export function computeSuiteFinalStatePermissive(
  suite: SuiteStats
): TestStatus {
  const failedDirect = suite.tests.some(
    (t) => typeof t !== 'string' && t.state === TEST_STATE.FAILED
  )
  const failedNested = (suite.suites ?? []).some(
    (s) => s.state === TEST_STATE.FAILED
  )
  return failedDirect || failedNested ? TEST_STATE.FAILED : TEST_STATE.PASSED
}

/**
 * "Strict" finalize: any failed → FAILED; all PASSED/SKIPPED → PASSED;
 * empty suite → PASSED; orphaned RUNNING tests → FAILED. Matches nightwatch's
 * policy — incomplete runs are surfaced as failures.
 */
export function computeSuiteFinalStateStrict(suite: SuiteStats): TestStatus {
  const tests = suite.tests as TestStats[]
  const suites = suite.suites ?? []
  const hasFailures =
    tests.some((t) => t.state === TEST_STATE.FAILED) ||
    suites.some((s) => s.state === TEST_STATE.FAILED)
  if (hasFailures) {
    return TEST_STATE.FAILED
  }
  const allPassed =
    tests.every(
      (t) => t.state === TEST_STATE.PASSED || t.state === TEST_STATE.SKIPPED
    ) &&
    suites.every(
      (s) => s.state === TEST_STATE.PASSED || s.state === TEST_STATE.SKIPPED
    )
  const hasSkipped = tests.some((t) => t.state === TEST_STATE.SKIPPED)
  const hasItems = tests.length > 0 || suites.length > 0
  if (!hasItems || allPassed) {
    return TEST_STATE.PASSED
  }
  if (hasSkipped) {
    return TEST_STATE.PASSED
  }
  return TEST_STATE.FAILED
}

/**
 * In-progress state computation: if any child is FAILED → FAILED;
 * else if any RUNNING / unfinished → RUNNING; else → PASSED. Used to keep
 * a parent suite's state fresh while children are still executing
 * (Cucumber feature suite updates as each scenario completes).
 */
export function computeSuiteRunningState(suite: SuiteStats): TestStatus {
  const tests = suite.tests as TestStats[]
  const suites = suite.suites ?? []
  const hasFailures =
    tests.some((t) => t.state === TEST_STATE.FAILED) ||
    suites.some((s) => s.state === TEST_STATE.FAILED)
  if (hasFailures) {
    return TEST_STATE.FAILED
  }
  const hasRunning =
    tests.some((t) => t.state === TEST_STATE.RUNNING) ||
    suites.some((s) => s.state === TEST_STATE.RUNNING || !s.end)
  return hasRunning ? TEST_STATE.RUNNING : TEST_STATE.PASSED
}

/**
 * Stamp `end` + `_duration` on a suite. Pure mutation — kept here so the
 * arithmetic stays in one place; callers still own the state assignment.
 */
export function stampSuiteEnd(suite: SuiteStats, end: Date = new Date()): void {
  suite.end = end
  suite._duration = end.getTime() - (suite.start?.getTime() || end.getTime())
}

/** Stamp `end` + `_duration` on a test. */
export function stampTestEnd(test: TestStats, end: Date = new Date()): void {
  test.end = end
  test._duration = end.getTime() - (test.start?.getTime() ?? end.getTime())
}

function deriveAncestorKind(
  suite: SuiteStats,
  parentKind: TestAncestor['kind'] | undefined
): TestAncestor['kind'] {
  if (parentKind === 'feature') {
    return 'scenario'
  }
  // Cucumber scenario suites carry the same .feature file as their parent —
  // only a suite not already under a feature/scenario counts as the feature.
  if (suite.file?.endsWith('.feature') && parentKind !== 'scenario') {
    return 'feature'
  }
  return 'suite'
}

/**
 * Recursive walk over suite trees collecting every test's metadata entry —
 * uid → title/specFile/state/attempt plus the ancestor chain (outermost
 * first, the test's own node excluded). Consolidates the per-adapter
 * collectTestMetadata walks.
 */
export function collectSuiteTestMetadata(
  suites: Iterable<SuiteStats>
): TestMetadataMap {
  const metadata: TestMetadataMap = new Map()
  const walk = (suite: SuiteStats, ancestors: TestAncestor[]): void => {
    const parentKind = ancestors[ancestors.length - 1]?.kind
    const chain: TestAncestor[] = [
      ...ancestors,
      {
        uid: suite.uid,
        title: suite.title,
        kind: deriveAncestorKind(suite, parentKind)
      }
    ]
    for (const entry of suite.tests ?? []) {
      // Trees can contain string placeholders for tests not yet reconciled.
      if (typeof entry !== 'object' || entry === null) {
        continue
      }
      metadata.set(entry.uid, {
        title: entry.fullTitle || entry.title,
        specFile: entry.file ?? suite.file,
        state: entry.state,
        attempt: entry.retries ?? 0,
        ancestry: chain
      })
    }
    for (const child of suite.suites ?? []) {
      walk(child, chain)
    }
  }
  for (const suite of suites) {
    if (typeof suite !== 'object' || suite === null) {
      continue
    }
    walk(suite, [])
  }
  return metadata
}
