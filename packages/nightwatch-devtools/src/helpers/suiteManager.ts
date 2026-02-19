/**
 * Suite Manager
 * Handles test suite creation and management
 */

import logger from '@wdio/logger'
import { DEFAULTS, TIMING, TEST_STATE } from '../constants.js'
import { determineTestState, type SuiteStats, type TestStats, type NightwatchTestCase } from '../types.js'
import type { TestReporter } from '../reporter.js'

const log = logger('@wdio/nightwatch-devtools:suiteManager')

export class SuiteManager {
  private currentSuiteByFile = new Map<string, SuiteStats>()

  constructor(private testReporter: TestReporter) {}

  /**
   * Get or create suite for a test file
   */
  getOrCreateSuite(
    testFile: string,
    suiteTitle: string,
    fullPath: string | null,
    testNames: string[]
  ): SuiteStats {
    if (!this.currentSuiteByFile.has(testFile)) {
      const suiteStats: SuiteStats = {
        uid: '',
        cid: DEFAULTS.CID,
        title: suiteTitle,
        fullTitle: suiteTitle,
        file: fullPath || testFile,
        type: 'suite' as const,
        start: new Date(),
        state: TEST_STATE.PENDING,
        end: null,
        tests: [],
        suites: [],
        hooks: [],
        _duration: DEFAULTS.DURATION
      }

      suiteStats.uid = this.testReporter.generateStableUid(suiteStats.file, suiteStats.title)

      // Create test entries with pending state
      if (testNames.length > 0) {
        for (const testName of testNames) {
          const fullTitle = `${suiteTitle} ${testName}`
          // Generate stable UID using same method as onTestStart
          const testUid = this.testReporter.generateStableUid(fullPath || testFile, fullTitle)
          const testEntry: TestStats = {
            uid: testUid,
            cid: DEFAULTS.CID,
            title: testName,
            fullTitle: fullTitle,
            parent: suiteStats.uid,
            state: TEST_STATE.PENDING as TestStats['state'],
            start: new Date(),
            end: null,
            type: 'test' as const,
            file: fullPath || testFile,
            retries: DEFAULTS.RETRIES,
            _duration: DEFAULTS.DURATION,
            hooks: []
          }
          suiteStats.tests.push(testEntry)
        }
        // Don't send updates here - onSuiteStart will send it
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
   * Mark suite as running
   */
  markSuiteAsRunning(suite: SuiteStats): void {
    suite.state = TEST_STATE.RUNNING
    this.testReporter.updateSuites()
  }

  /**
   * Finalize suite with test results
   */
  finalizeSuite(suite: SuiteStats): void {
    if (suite.end) return // Already finalized

    suite.end = new Date()
    suite._duration = suite.end.getTime() - (suite.start?.getTime() || 0)

    const hasFailures = suite.tests.some((t: any) => t.state === TEST_STATE.FAILED)
    const allPassed = suite.tests.every((t: any) => t.state === TEST_STATE.PASSED)
    const hasSkipped = suite.tests.some((t: any) => t.state === TEST_STATE.SKIPPED)

    if (hasFailures) {
      suite.state = TEST_STATE.FAILED
    } else if (allPassed) {
      suite.state = TEST_STATE.PASSED
    } else if (hasSkipped) {
      suite.state = TEST_STATE.PASSED
    } else {
      suite.state = TEST_STATE.FAILED
    }

    this.testReporter.onSuiteEnd(suite)
  }

  /**
   * Get all suites
   */
  getAllSuites(): Map<string, SuiteStats> {
    return this.currentSuiteByFile
  }
}
