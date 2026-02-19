/**
 * Test Manager
 * Handles test lifecycle, state management, and boundary detection
 */

import logger from '@wdio/logger'
import { TEST_STATE, DEFAULTS } from '../constants.js'
import { determineTestState, type TestStats, type SuiteStats, type NightwatchTestCase } from '../types.js'
import type { TestReporter } from '../reporter.js'

const log = logger('@wdio/nightwatch-devtools:testManager')

export class TestManager {
  private processedTests = new Map<string, Set<string>>()
  private lastKnownTestName: string | null = null

  constructor(private testReporter: TestReporter) {}

  /**
   * Update test state and report to UI
   */
  updateTestState(
    test: TestStats,
    state: TestStats['state'],
    endTime?: Date,
    duration?: number
  ): void {
    test.state = state
    if (endTime) test.end = endTime
    if (duration !== undefined) test._duration = duration

    if (state === TEST_STATE.PASSED) {
      this.testReporter.onTestPass(test)
    } else if (state === TEST_STATE.FAILED) {
      this.testReporter.onTestFail(test)
    } else if (state === TEST_STATE.RUNNING) {
      this.testReporter.onTestStart(test)
    }

    if (state !== TEST_STATE.RUNNING) {
      this.testReporter.onTestEnd(test)
    }
  }

  /**
   * Find test in suite by title
   */
  findTestInSuite(suite: SuiteStats, testTitle: string): TestStats | undefined {
    return suite.tests.find(
      (t): t is TestStats => typeof t !== 'string' && t.title === testTitle
    )
  }

  /**
   * Mark test as processed to avoid duplicate reporting
   */
  markTestAsProcessed(testFile: string, testTitle: string): void {
    if (!this.processedTests.has(testFile)) {
      this.processedTests.set(testFile, new Set())
    }
    this.processedTests.get(testFile)!.add(testTitle)
  }

  /**
   * Check if test has been processed
   */
  isTestProcessed(testFile: string, testTitle: string): boolean {
    return this.processedTests.get(testFile)?.has(testTitle) ?? false
  }

  /**
   * Get processed tests for a file
   */
  getProcessedTests(testFile: string): Set<string> {
    return this.processedTests.get(testFile) || new Set()
  }

  /**
   * Detect test boundary and finalize previous test if needed
   * Returns the current test name
   */
  detectTestBoundary(currentNightwatchTest: any): string {
    const currentTestName = currentNightwatchTest?.name || DEFAULTS.TEST_NAME

    // If test name changed, finalize previous test
    if (this.lastKnownTestName &&
        currentTestName !== this.lastKnownTestName &&
        currentTestName !== DEFAULTS.TEST_NAME) {

      const testFile = currentNightwatchTest.module?.split('/').pop() || DEFAULTS.FILE_NAME
      const currentSuite = this.testReporter.getCurrentSuite()

      if (currentSuite) {
        const prevTest = this.findTestInSuite(currentSuite, this.lastKnownTestName)
        if (prevTest && prevTest.state === TEST_STATE.RUNNING) {
          const prevTestCase = currentNightwatchTest.results?.testcases?.[this.lastKnownTestName]

          if (prevTestCase) {
            const testState = determineTestState(prevTestCase)
            this.updateTestState(prevTest, testState, new Date(), parseFloat(prevTestCase.time || '0') * 1000)
            this.markTestAsProcessed(testFile, this.lastKnownTestName)
          }
        }
      }
    }

    // Update last known test name
    if (currentTestName !== DEFAULTS.TEST_NAME) {
      this.lastKnownTestName = currentTestName
    }

    return currentTestName
  }

  /**
   * Start a pending test if this is its first command
   */
  startTestIfPending(currentTestName: string): void {
    if (currentTestName === DEFAULTS.TEST_NAME || this.lastKnownTestName !== currentTestName) {
      return
    }

    const currentSuite = this.testReporter.getCurrentSuite()
    if (!currentSuite) return

    const test = this.findTestInSuite(currentSuite, currentTestName)
    if (test && test.state === TEST_STATE.PENDING) {
      test.start = new Date()
      test.end = null
      this.updateTestState(test, TEST_STATE.RUNNING as TestStats['state'])
    }
  }

  /**
   * Finalize all incomplete tests in a suite
   */
  finalizeSuiteTests(suite: SuiteStats, testcases: Record<string, NightwatchTestCase>): void {
    suite.tests.forEach((test: any) => {
      if (test.state === TEST_STATE.RUNNING && test.start) {
        // Test was started but never finished - assume passed
        test.state = TEST_STATE.PASSED
        test.end = new Date()
        test._duration = test.end.getTime() - (test.start?.getTime() || 0)
        this.updateTestState(test, TEST_STATE.PASSED as TestStats['state'])
      } else if (test.state === TEST_STATE.PENDING) {
        const testcase = testcases[test.title]
        if (testcase) {
          const testState = determineTestState(testcase)
          test.start = test.start || new Date()
          this.updateTestState(test, testState, new Date(), parseFloat(testcase.time || '0') * 1000)
        } else {
          // Test never ran - mark as skipped
          this.updateTestState(test, TEST_STATE.SKIPPED as TestStats['state'], new Date(), 0)
        }
      }
    })
  }

  /**
   * Reset internal state for new test files
   */
  reset(): void {
    this.lastKnownTestName = null
  }
}
