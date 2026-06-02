import logger from '@wdio/logger'
import { TIMING, TEST_STATE } from '../constants.js'
import type { NightwatchTestCase, TestStats } from '../types.js'
import { determineTestState } from './utils.js'
import type { TestManager } from './testManager.js'

const log = logger('@wdio/nightwatch-devtools:closePreviousTest')

export interface ClosePreviousTestInput {
  runningTest: TestStats
  testFile: string
  /** `currentTest?.results?.testcases || {}` — Nightwatch's per-suite testcase results. */
  testcases: Record<string, NightwatchTestCase>
  testManager: TestManager
  /** Plugin-side pass/fail/skip counter — called once with the resolved final state. */
  incrementCount: (state: TestStats['state']) => void
  /** Plugin-side icon resolver for the log line (✅/❌/⏭ etc.). */
  testIcon: (state: TestStats['state']) => string
}

/**
 * Close out the previously-running test when beforeEach fires for the next
 * one. Resolves the final state from Nightwatch's testcases bag if available
 * (preferred — has real timing), otherwise assumes PASSED (the runner only
 * advances to beforeEach if the prior test didn't throw). Returns nothing —
 * pure side-effect orchestration over the test, testManager, and the plugin's
 * counter / icon helpers.
 *
 * Extracted from `NightwatchDevToolsPlugin.beforeEach` — the ~37-line block
 * was the second-densest section of the 142-line method.
 */
export async function closePreviousTest(
  input: ClosePreviousTestInput
): Promise<void> {
  const {
    runningTest,
    testFile,
    testcases,
    testManager,
    incrementCount,
    testIcon
  } = input

  if (testcases[runningTest.title]) {
    const testcase = testcases[runningTest.title]
    const testState = determineTestState(testcase)
    runningTest.state = testState
    runningTest.end = new Date()
    runningTest._duration = parseFloat(testcase.time || '0') * 1000
    testManager.updateTestState(runningTest, testState)
    testManager.markTestAsProcessed(testFile, runningTest.title)
    incrementCount(testState)
    log.info(
      `  ${testIcon(testState)} ${runningTest.title} (${(runningTest._duration / 1000).toFixed(2)}s)`
    )
  } else {
    const endTime = new Date()
    const duration = endTime.getTime() - (runningTest.start?.getTime() || 0)
    testManager.updateTestState(
      runningTest,
      TEST_STATE.PASSED as TestStats['state'],
      endTime,
      duration
    )
    testManager.markTestAsProcessed(testFile, runningTest.title)
    incrementCount(TEST_STATE.PASSED as TestStats['state'])
    log.info(`  ✅ ${runningTest.title} (${(duration / 1000).toFixed(2)}s)`)
  }
  // Brief settle so the dashboard renders the terminal state before the next
  // test's "running" update arrives.
  await new Promise((resolve) => setTimeout(resolve, TIMING.UI_RENDER_DELAY))
}
