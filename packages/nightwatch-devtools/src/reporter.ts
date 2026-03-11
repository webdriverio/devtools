import logger from '@wdio/logger'
import {
  extractTestMetadata,
  generateStableUid,
  resetSignatureCounters
} from './helpers/utils.js'
import type { SuiteStats, TestStats } from './types.js'

const log = logger('@wdio/nightwatch-devtools:Reporter')

export class TestReporter {
  #report: (data: any) => void
  #currentSpecFile?: string
  #testNamesCache = new Map<string, string[]>()
  #currentSuite?: SuiteStats
  #allSuites: SuiteStats[] = []

  constructor(report: (data: any) => void) {
    this.#report = report
    resetSignatureCounters()
  }

  /**
   * Called when a suite starts
   */
  onSuiteStart(suiteStats: SuiteStats) {
    this.#currentSpecFile = suiteStats.file
    this.#currentSuite = suiteStats

    // Generate stable UID only if not already set
    if (!suiteStats.uid) {
      suiteStats.uid = generateStableUid(suiteStats)
    }

    // Extract test names from source file
    if (
      this.#currentSpecFile &&
      !this.#testNamesCache.has(this.#currentSpecFile)
    ) {
      const metadata = extractTestMetadata(this.#currentSpecFile)
      const testNames = metadata.testNames
      if (testNames.length > 0) {
        this.#testNamesCache.set(this.#currentSpecFile, testNames)
        log.info(
          `📝 Extracted ${testNames.length} test names from ${this.#currentSpecFile}`
        )
      }
    }

    this.#allSuites.push(suiteStats)
    this.#sendUpstream()
  }

  /**
   * Update the upstream reporter callback (used after a WebDriver session change
   * so suite data is sent over the new WebSocket without rebuilding the reporter).
   */
  updateUpstream(report: (data: any) => void) {
    this.#report = report
  }

  /**
   * Update the suites data (send to UI)
   */
  updateSuites() {
    this.#sendUpstream()
  }

  /**
   * Get the current suite
   */
  getCurrentSuite(): SuiteStats | undefined {
    return this.#currentSuite
  }

  /**
   * Called when a test starts
   */
  onTestStart(testStats: TestStats) {
    // Generate stable UID (hashed, so consistent even if called multiple times)
    if (!testStats.uid || testStats.uid.includes('temp-')) {
      testStats.uid = generateStableUid(testStats)
    }

    // Search for test by title within parent suite
    for (const suite of this.#allSuites) {
      const testIndex = suite.tests.findIndex((t) => {
        if (typeof t === 'string') {
          return false
        }
        // Match by title and parent suite
        return t.title === testStats.title && t.parent === suite.uid
      })
      if (testIndex !== -1) {
        // Update existing test
        suite.tests[testIndex] = testStats
        this.#sendUpstream()
        return
      }
    }

    // Test not found in any suite, add it to current suite (legacy behavior)
    if (this.#currentSuite) {
      this.#currentSuite.tests.push(testStats)
    }

    this.#sendUpstream()
  }

  /**
   * Called when a test ends
   */
  onTestEnd(testStats: TestStats) {
    // Search all suites for this test (not just current suite)
    for (const suite of this.#allSuites) {
      const testIndex = suite.tests.findIndex(
        (t) => (typeof t === 'string' ? t : t.uid) === testStats.uid
      )
      if (testIndex !== -1) {
        suite.tests[testIndex] = testStats
        break
      }
    }

    this.#sendUpstream()
  }

  /**
   * Called when a test passes
   */
  onTestPass(testStats: TestStats) {
    // Search all suites for this test (not just current suite)
    for (const suite of this.#allSuites) {
      const testIndex = suite.tests.findIndex(
        (t) => (typeof t === 'string' ? t : t.uid) === testStats.uid
      )
      if (testIndex !== -1) {
        suite.tests[testIndex] = testStats
        break
      }
    }

    this.#sendUpstream()
  }

  /**
   * Called when a test fails
   */
  onTestFail(testStats: TestStats) {
    // Search all suites for this test (not just current suite)
    for (const suite of this.#allSuites) {
      const testIndex = suite.tests.findIndex(
        (t) => (typeof t === 'string' ? t : t.uid) === testStats.uid
      )
      if (testIndex !== -1) {
        suite.tests[testIndex] = testStats
        break
      }
    }

    this.#sendUpstream()
  }

  /**
   * Called when a suite ends - create skipped tests
   */
  onSuiteEnd(suiteStats: SuiteStats) {
    // Get all test names from cache
    const cachedNames = this.#testNamesCache.get(suiteStats.file) || []
    const processedTestNames = new Set(
      suiteStats.tests
        .map((t) => (typeof t === 'string' ? t : t.title))
        .filter((title): title is string => Boolean(title))
    )

    // Create skipped tests for tests that didn't run
    cachedNames.forEach((testName) => {
      if (!processedTestNames.has(testName)) {
        const skippedTest: TestStats = {
          uid: generateStableUid({
            file: suiteStats.file,
            fullTitle: `${suiteStats.title} ${testName}`
          } as TestStats),
          cid: '0-0',
          title: testName,
          fullTitle: `${suiteStats.title} ${testName}`,
          parent: suiteStats.uid,
          state: 'skipped',
          start: new Date(),
          end: new Date(),
          type: 'test',
          file: suiteStats.file,
          retries: 0,
          _duration: 0,
          hooks: []
        }

        suiteStats.tests.push(skippedTest)
        log.info(`Created skipped test "${testName}" (never executed)`)
      }
    })

    this.#sendUpstream()
  }

  /**
   * Update a specific suite and send to UI (used when updating suite title)
   */
  updateSuite(suiteStats: SuiteStats) {
    // Find and remove the old suite by file
    const index = this.#allSuites.findIndex((s) => s.file === suiteStats.file)
    if (index !== -1) {
      // Remove the old suite entry (with old UID)
      this.#allSuites.splice(index, 1)
    }
    // Add the updated suite with new UID
    this.#allSuites.push(suiteStats)
    // Update current suite reference
    this.#currentSuite = suiteStats
    this.#sendUpstream()
  }

  #sendUpstream() {
    const payload: Record<string, SuiteStats>[] = []

    for (const suite of this.#allSuites) {
      if (suite && suite.uid) {
        // Each suite becomes an object with its UID as the key
        payload.push({ [suite.uid]: suite })
      }
    }

    if (payload.length > 0) {
      this.#report(payload)
    }
  }

  get report() {
    return this.#allSuites
  }
}
