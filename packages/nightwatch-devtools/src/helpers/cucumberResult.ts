import { TEST_STATE } from '../constants.js'
import type { SuiteStats, TestStats } from '../types.js'

/**
 * Map a Cucumber Pickle step result's `status` field (PASSED/FAILED/SKIPPED/
 * UNKNOWN/PENDING/AMBIGUOUS/UNDEFINED) to the dashboard's TestStats state.
 * Everything non-passed and non-skipped is treated as FAILED for the UI —
 * the underlying error/message survives in the pickle for the Compare view.
 */
export function cucumberResultToTestState(result: unknown): TestStats['state'] {
  const status = String(
    (result as { status?: unknown })?.status ?? 'UNKNOWN'
  ).toUpperCase()
  if (status === 'PASSED') {
    return TEST_STATE.PASSED
  }
  if (status === 'SKIPPED') {
    return TEST_STATE.SKIPPED
  }
  return TEST_STATE.FAILED
}

/**
 * Cucumber's After hook fires with the scenario's final status, but any
 * still-running or pending steps (e.g. an early failure short-circuited
 * the rest) need to be closed too. Mark them PASSED only when the whole
 * scenario passed; FAILED otherwise. Pure in-place mutation — the suite's
 * `tests` array references are the same TestStats objects the dashboard
 * already received via earlier WS broadcasts.
 */
export function closeOpenSteps(
  suite: SuiteStats,
  scenarioState: TestStats['state'],
  now: Date = new Date()
): void {
  for (const step of suite.tests) {
    if (typeof step === 'string') {
      continue
    }
    if (step.state === 'running' || step.state === 'pending') {
      step.state =
        scenarioState === TEST_STATE.PASSED
          ? TEST_STATE.PASSED
          : TEST_STATE.FAILED
      step.end = now
    }
  }
}
