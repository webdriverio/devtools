import logger from '@wdio/logger'
import { TestReporterBase } from '@wdio/devtools-core'
import { DEFAULTS } from './constants.js'
import { extractTestMetadata, generateStableUid } from './helpers/utils.js'
import type { SuiteStats, TestStats } from './types.js'

const log = logger('@wdio/nightwatch-devtools:Reporter')

export class TestReporter extends TestReporterBase {
  #currentSpecFile?: string
  #testNamesCache = new Map<string, string[]>()
  #currentSuite?: SuiteStats

  onSuiteStart(suiteStats: SuiteStats) {
    this.#currentSpecFile = suiteStats.file
    this.#currentSuite = suiteStats
    const rerunLabel =
      process.env.DEVTOOLS_RERUN_ENTRY_TYPE === 'test'
        ? process.env.DEVTOOLS_RERUN_LABEL?.trim()
        : undefined

    if (!suiteStats.uid) {
      suiteStats.uid = generateStableUid(suiteStats)
    }

    if (
      this.#currentSpecFile &&
      !this.#testNamesCache.has(this.#currentSpecFile)
    ) {
      const metadata = extractTestMetadata(this.#currentSpecFile)
      const testNames = rerunLabel
        ? metadata.testNames.filter((name) => name === rerunLabel)
        : metadata.testNames
      if (testNames.length > 0) {
        this.#testNamesCache.set(this.#currentSpecFile, testNames)
        log.info(
          `📝 Extracted ${testNames.length} test names from ${this.#currentSpecFile}`
        )
      }
    }

    this.allSuites.push(suiteStats)
    this.sendUpstream()
  }

  override clearExecutionData() {
    super.clearExecutionData()
    this.#testNamesCache.clear()
    this.#currentSuite = undefined
    this.#currentSpecFile = undefined
  }

  getCurrentSuite(): SuiteStats | undefined {
    return this.#currentSuite
  }

  /** Find by title within parent suite — Nightwatch retries reuse the title slot. */
  onTestStart(testStats: TestStats) {
    if (!testStats.uid || testStats.uid.includes('temp-')) {
      testStats.uid = generateStableUid(testStats)
    }

    for (const suite of this.allSuites) {
      const testIndex = suite.tests.findIndex((t) => {
        if (typeof t === 'string') {
          return false
        }
        return t.title === testStats.title && t.parent === suite.uid
      })
      if (testIndex !== -1) {
        suite.tests[testIndex] = testStats
        this.sendUpstream()
        return
      }
    }

    if (this.#currentSuite) {
      this.#currentSuite.tests.push(testStats)
    }
    this.sendUpstream()
  }

  /** Synthesize `skipped` entries for tests that never executed. */
  override onSuiteEnd(suiteStats: SuiteStats) {
    const cachedNames = this.#testNamesCache.get(suiteStats.file) || []
    const processedTestNames = new Set(
      suiteStats.tests
        .map((t) => (typeof t === 'string' ? t : t.title))
        .filter((title): title is string => Boolean(title))
    )

    cachedNames.forEach((testName) => {
      if (!processedTestNames.has(testName)) {
        const skippedTest: TestStats = {
          uid: generateStableUid({
            file: suiteStats.file,
            fullTitle: `${suiteStats.title} ${testName}`
          } as TestStats),
          cid: DEFAULTS.CID,
          title: testName,
          fullTitle: `${suiteStats.title} ${testName}`,
          parent: suiteStats.uid,
          state: 'skipped',
          start: new Date(),
          end: new Date(),
          type: 'test',
          file: suiteStats.file,
          retries: DEFAULTS.RETRIES,
          _duration: DEFAULTS.DURATION,
          hooks: []
        }
        suiteStats.tests.push(skippedTest)
        log.info(`Created skipped test "${testName}" (never executed)`)
      }
    })

    this.sendUpstream()
  }

  /** Replace a suite when its UID changes mid-run (after spec rescan). */
  updateSuite(suiteStats: SuiteStats) {
    const index = this.allSuites.findIndex((s) => s.file === suiteStats.file)
    if (index !== -1) {
      this.allSuites.splice(index, 1)
    }
    this.allSuites.push(suiteStats)
    this.#currentSuite = suiteStats
    this.sendUpstream()
  }
}
