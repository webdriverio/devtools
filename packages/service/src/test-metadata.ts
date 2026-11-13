// Per-test metadata helpers shared between the before* and after* hooks so the
// state stamp in afterTest/afterScenario lands on the entry beforeTest created.

import { deterministicUid, type TestAttemptTracker } from '@wdio/devtools-core'
import {
  FEATURE_FILE_RE,
  type TestMetadataMap,
  type TestStatus
} from '@wdio/devtools-shared'
import type { RetriedTest } from './types.js'

/** The subset of a WDIO afterTest/afterScenario hook result this adapter reads:
 *  pass/skip state, the error, and WDIO's authoritative 0-based retry count. */
export interface TestOutcomeResult {
  error?: unknown
  passed?: boolean
  skipped?: boolean
  retries?: { attempts?: number }
}

/** Stable per-test key. beforeTest and afterTest derive it identically so keys
 *  match. File-less runners (some non-WDIO frameworks) key on the title alone. */
export function testMetadataUid(
  file: string | undefined,
  title: string
): string {
  return file ? deterministicUid(file, title) : title
}

/** Scenario key that separates scenario-outline example rows: they share a
 *  name, so the pickle's astNodeIds (distinct per row, stable across reruns)
 *  are folded in. beforeScenario and afterScenario derive it identically. */
export function cucumberScenarioUid(
  uri: string,
  name: string,
  astNodeIds?: readonly string[]
): string {
  return astNodeIds?.length
    ? deterministicUid(uri, name, astNodeIds.join(':'))
    : deterministicUid(uri, name)
}

/** Canonical test state from a WDIO afterTest/afterScenario result. */
export function resultToState(result: {
  passed?: boolean
  skipped?: boolean
}): TestStatus {
  if (result.skipped) {
    return 'skipped'
  }
  return result.passed ? 'passed' : 'failed'
}

/** True when a result represents a failed test (not passed, not skipped).
 *  Absent result → not failed (nothing ran to fail). */
export function isFailedResult(
  result?: Pick<TestOutcomeResult, 'passed' | 'skipped'>
): boolean {
  return result ? resultToState(result) === 'failed' : false
}

/** Stamp the final state (and, when known, the 0-based attempt) onto the
 *  metadata entry beforeTest/beforeScenario created, so retention can gate its
 *  trace per attempt. No-op when there's no entry. */
export function stampTestState(
  metadata: TestMetadataMap,
  uid: string,
  result?: Pick<TestOutcomeResult, 'passed' | 'skipped'>,
  attempt?: number
): void {
  const entry = result && metadata.get(uid)
  if (entry) {
    entry.state = resultToState(result)
    if (attempt !== undefined) {
      entry.attempt = attempt
    }
  }
}

/** Resolve the 0-based attempt for a test. WDIO's mocha framework reports
 *  `retries.attempts` as 0 even on a retry, so it can't override the in-process
 *  tracker — take the max so a present-but-zero runner field never clobbers a
 *  real retry count, while a genuine runner value still wins when it's higher. */
export function resolveTestAttempt(
  result: Pick<TestOutcomeResult, 'retries'> | undefined,
  fallback: number
): number {
  const attempts = result?.retries?.attempts
  return Math.max(typeof attempts === 'number' ? attempts : 0, fallback)
}

/** The ledger uid of a test the reporter saw retried, matched on file and title (the reporter's uid and dotted fullTitle are its own); a Cucumber retry is always the current scenario's. */
export function retriedTestUid(
  metadata: TestMetadataMap,
  started: (uid: string) => boolean,
  test: RetriedTest,
  fallback: string | undefined
): string | undefined {
  // A step title can equal another scenario's name, so a feature file's retry is never matched by title.
  if (FEATURE_FILE_RE.test(test.file ?? '')) {
    return fallback
  }
  const named = (suffix: string) =>
    [...metadata].filter(
      ([uid, entry]) =>
        started(uid) &&
        entry.specFile === test.file &&
        (entry.title === suffix || entry.title.endsWith(` ${suffix}`))
    )
  const byTitle = named(test.title)
  const matches =
    byTitle.length > 1 && test.parent
      ? named(`${test.parent} ${test.title}`)
      : byTitle
  return matches.length === 1 ? matches[0][0] : fallback
}

/** Stamp a reporter `test:retry` failed in the ledger; a test it cannot name (a Cucumber step) is the current one, still open. */
export function recordRetriedAttempt(
  tracker: Pick<TestAttemptTracker, 'attemptFor' | 'recordOutcome'>,
  metadata: TestMetadataMap,
  { retried, current }: { retried: RetriedTest; current?: string }
): void {
  const started = (uid: string) => tracker.attemptFor(uid) !== undefined
  const uid = retriedTestUid(metadata, started, retried, current)
  if (uid) {
    tracker.recordOutcome(uid, 'failed')
  }
}
