import logger from '@wdio/logger'
import { extractTestMetadata } from './helpers/utils.js'
import type { SuiteStats, TestStats } from './types.js'

const log = logger('@wdio/nightwatch-devtools:Reporter')

// Track test occurrences to generate stable UIDs
const signatureCounters = new Map<string, number>()

/**
 * Generate stable UID based on test/suite metadata (WDIO approach)
 * Use only stable identifiers (file + fullTitle) that don't change between runs
 */
function generateStableUid(item: SuiteStats | TestStats): string {
  const rawItem = item as any

  // Use file and fullTitle as stable identifiers
  // DO NOT use cid or parent as they can vary based on run context
  const parts = [rawItem.file || '', String(rawItem.fullTitle || item.title)]

  const signature = parts.join('::')
  const count = signatureCounters.get(signature) || 0
  signatureCounters.set(signature, count + 1)

  if (count > 0) {
    parts.push(String(count))
  }

  // Generate hash for stable, short UIDs
  const hash = parts
    .join('::')
    .split('')
    .reduce((acc, char) => {
      return ((acc << 5) - acc + char.charCodeAt(0)) | 0
    }, 0)

  return `stable-${Math.abs(hash).toString(36)}`
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
   * Generate stable UID for test/suite - public method (WDIO approach)
   */
  generateStableUid(filePath: string, name: string): string {
    const parts = [filePath, name]
    const signature = parts.join('::')
    const count = signatureCounters.get(signature) || 0
    signatureCounters.set(signature, count + 1)

    if (count > 0) {
      parts.push(String(count))
    }

    // Generate hash for stable, short UIDs
    const hash = parts
      .join('::')
      .split('')
      .reduce((acc, char) => {
        return ((acc << 5) - acc + char.charCodeAt(0)) | 0
      }, 0)

    return `stable-${Math.abs(hash).toString(36)}`
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
      const testIndex = suite.tests.findIndex(
        (t) => {
          if (typeof t === 'string') return false
          // Match by title and parent suite
          return t.title === testStats.title && t.parent === suite.uid
        }
      )
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
