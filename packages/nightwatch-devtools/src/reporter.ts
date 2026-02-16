import logger from '@wdio/logger'
import { extractTestMetadata } from './utils.js'
import type { SuiteStats, TestStats } from './types.js'

const log = logger('@wdio/nightwatch-devtools:Reporter')

// Track test occurrences to generate stable UIDs
const signatureCounters = new Map<string, number>()

/**
 * Generate stable UID based on test/suite metadata
 */
function generateStableUid(item: SuiteStats | TestStats): string {
  const signature = `${item.file}::${item.fullTitle}`
  const currentCount = signatureCounters.get(signature) || 0
  signatureCounters.set(signature, currentCount + 1)
  
  return currentCount > 0
    ? `${signature}::${currentCount}`
    : signature
}

/**
 * Reset counters at the start of each test run
 */
function resetSignatureCounters() {
  signatureCounters.clear()
}

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
   * Generate stable UID for test/suite - public method
   */
  generateStableUid(filePath: string, name: string): string {
    const signature = `${filePath}::${name}`
    const currentCount = signatureCounters.get(signature) || 0
    signatureCounters.set(signature, currentCount + 1)
    
    return currentCount > 0
      ? `${signature}::${currentCount}`
      : signature
  }

  /**
   * Called when a suite starts
   */
  onSuiteStart(suiteStats: SuiteStats) {
    this.#currentSpecFile = suiteStats.file
    this.#currentSuite = suiteStats

    // Generate stable UID
    suiteStats.uid = generateStableUid(suiteStats)

    // Extract test names from source file
    if (suiteStats.file && !this.#testNamesCache.has(suiteStats.file)) {
      const metadata = extractTestMetadata(suiteStats.file)
      const testNames = metadata.testNames
      if (testNames.length > 0) {
        this.#testNamesCache.set(suiteStats.file, testNames)
        log.info(`📝 Extracted ${testNames.length} test names from ${suiteStats.file}`)
      }
    }

    this.#allSuites.push(suiteStats)
    this.#sendUpstream()
  }

  /**
   * Update the suites data (send to UI)
   */
  updateSuites() {
    this.#sendUpstream()
  }

  /**
   * Called when a test starts
   */
  onTestStart(testStats: TestStats) {
    // Generate stable UID if not already set
    if (!testStats.uid || testStats.uid.includes('temp-')) {
      testStats.uid = generateStableUid(testStats)
    }

    // Update existing test in current suite (don't add duplicates)
    if (this.#currentSuite) {
      const testIndex = this.#currentSuite.tests.findIndex(
        (t) => typeof t !== 'string' && t.title === testStats.title
      )
      if (testIndex !== -1) {
        // Update existing test
        this.#currentSuite.tests[testIndex] = testStats
      } else {
        // Test not found, add it (legacy behavior)
        this.#currentSuite.tests.push(testStats)
      }
    }

    this.#sendUpstream()
  }

  /**
   * Called when a test ends
   */
  onTestEnd(testStats: TestStats) {
    // Update the test in current suite
    if (this.#currentSuite) {
      const testIndex = this.#currentSuite.tests.findIndex(
        (t) => (typeof t === 'string' ? t : t.uid) === testStats.uid
      )
      if (testIndex !== -1) {
        this.#currentSuite.tests[testIndex] = testStats
      }
    }

    this.#sendUpstream()
  }

  /**
   * Called when a test passes
   */
  onTestPass(testStats: TestStats) {
    // Update the test in current suite
    if (this.#currentSuite) {
      const testIndex = this.#currentSuite.tests.findIndex(
        (t) => (typeof t === 'string' ? t : t.uid) === testStats.uid
      )
      if (testIndex !== -1) {
        this.#currentSuite.tests[testIndex] = testStats
      }
    }

    this.#sendUpstream()
  }

  /**
   * Called when a test fails
   */
  onTestFail(testStats: TestStats) {
    // Update the test in current suite
    if (this.#currentSuite) {
      const testIndex = this.#currentSuite.tests.findIndex(
        (t) => (typeof t === 'string' ? t : t.uid) === testStats.uid
      )
      if (testIndex !== -1) {
        this.#currentSuite.tests[testIndex] = testStats
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
    const index = this.#allSuites.findIndex(s => s.file === suiteStats.file)
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
    // Convert suites to WDIO format: array of objects with UID as key
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
