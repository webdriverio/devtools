/**
 * Suite Manager — Nightwatch flavor.
 * Maintains one suite per test file (Nightwatch runs each file independently).
 * Shares the suite factory + state-computation logic with selenium via
 * @wdio/devtools-core's suite-helpers; the storage strategy (Map by file)
 * is Nightwatch-specific and stays here.
 */

import {
  computeSuiteFinalStateStrict,
  computeSuiteRunningState,
  createSuiteStats,
  createTestStats,
  stampSuiteEnd
} from '@wdio/devtools-core'
import { DEFAULTS, TEST_STATE } from '../constants.js'
import type { SuiteStats, TestStats } from '../types.js'
import type { TestReporter } from '../reporter.js'
import { generateStableUid } from './utils.js'

export class SuiteManager {
  private currentSuiteByFile = new Map<string, SuiteStats>()

  constructor(private testReporter: TestReporter) {}

  /**
   * Clear execution data when a rerun starts.
   * Resets all cached suites so they're recreated fresh during the new run.
   */
  clearExecutionData() {
    this.currentSuiteByFile.clear()
  }

  /**
   * Get or create suite for a test file
   */
  getOrCreateSuite(
    testFile: string,
    suiteTitle: string,
    fullPath: string | null,
    testNames: string[],
    suiteLine?: number | null,
    testLines?: number[]
  ): SuiteStats {
    if (!this.currentSuiteByFile.has(testFile)) {
      const file = fullPath || testFile
      const suiteStats = createSuiteStats({
        uid: generateStableUid(file, suiteTitle),
        cid: DEFAULTS.CID,
        title: suiteTitle,
        file,
        state: TEST_STATE.PENDING as TestStats['state'],
        callSource:
          suiteLine && fullPath ? `${fullPath}:${suiteLine}` : undefined
      })

      // Create test entries with pending state
      for (let idx = 0; idx < testNames.length; idx++) {
        const testName = testNames[idx]
        const testLine = testLines?.[idx]
        const fullTitle = `${suiteTitle} ${testName}`
        const testEntry = createTestStats({
          uid: generateStableUid(file, fullTitle),
          cid: DEFAULTS.CID,
          title: testName,
          fullTitle,
          file,
          parent: suiteStats.uid,
          state: TEST_STATE.PENDING as TestStats['state'],
          callSource:
            testLine && fullPath ? `${fullPath}:${testLine}` : undefined
        })
        suiteStats.tests.push(testEntry)
      }

      this.currentSuiteByFile.set(testFile, suiteStats)
      this.testReporter.onSuiteStart(suiteStats)
    }

    return this.currentSuiteByFile.get(testFile)!
  }

  /**
   * Get suite for a test file
   */
  getSuite(testFile: string): SuiteStats | undefined {
    return this.currentSuiteByFile.get(testFile)
  }

  /**
   * Mark suite as running.
   * Clears `end` so that the `finalizeSuite` guard (`if (suite.end) return`)
   * does not skip re-finalization during a rerun.
   */
  markSuiteAsRunning(suite: SuiteStats): void {
    suite.state = TEST_STATE.RUNNING
    suite.end = null
    this.testReporter.updateSuites()
  }

  /**
   * Update suite state from current children without marking it as ended.
   * Used during Cucumber runs to keep the feature-level suite state fresh.
   */
  finalizeSuiteState(suite: SuiteStats): void {
    suite.state = computeSuiteRunningState(suite)
    this.testReporter.updateSuites()
  }

  /**
   * Finalize suite with test results
   */
  finalizeSuite(suite: SuiteStats): void {
    if (suite.end) {
      return
    }
    stampSuiteEnd(suite)
    suite.state = computeSuiteFinalStateStrict(suite)
    this.testReporter.onSuiteEnd(suite)
  }

  /**
   * Get all suites
   */
  getAllSuites(): Map<string, SuiteStats> {
    return this.currentSuiteByFile
  }
}
