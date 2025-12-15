import WebdriverIOReporter, {
  type SuiteStats,
  type TestStats
} from '@wdio/reporter'
import {
  mapTestToSource,
  setCurrentSpecFile,
  mapSuiteToSource
} from './utils.js'

// Track test/suite occurrences within current run to handle duplicate signatures
// (e.g., Cucumber Scenario Outline example rows)
const signatureCounters = new Map<string, number>()

// Generate stable UID based on test/suite metadata
function generateStableUid(item: SuiteStats | TestStats): string {
  const parts = [
    item.title,
    (item as any).file || '',
    String((item as any).fullTitle || item.title),
    // Include cid to differentiate parallel runs
    (item as any).cid || '',
    // Include parent to differentiate nested structures
    (item as any).parent || ''
  ]

  // Create a signature for this test/suite
  const signature = parts.join('::')

  // Track occurrences to handle Cucumber example rows or other duplicate scenarios
  const count = signatureCounters.get(signature) || 0
  signatureCounters.set(signature, count + 1)

  // Include counter only if this signature has appeared multiple times
  if (count > 0) {
    parts.push(String(count))
  }

  // Simple hash function
  const hash = parts.join('::').split('').reduce((acc, char) => {
    return ((acc << 5) - acc + char.charCodeAt(0)) | 0
  }, 0)

  return `stable-${Math.abs(hash).toString(36)}`
}

// Reset counters at the start of each test run
function resetSignatureCounters() {
  signatureCounters.clear()
}

export class TestReporter extends WebdriverIOReporter {
  #report: (data: any) => void
  #currentSpecFile?: string
  #suitePath: string[] = []

  constructor(options: any, report: (data: any) => void) {
    super(options)
    this.#report = report
    // Reset signature counters for each new reporter instance (new test run)
    resetSignatureCounters()
  }

  onSuiteStart(suiteStats: SuiteStats): void {
    super.onSuiteStart(suiteStats)

    // Override with stable UID
    const stableUid = generateStableUid(suiteStats)
    ;(suiteStats as any).uid = stableUid

    this.#currentSpecFile = suiteStats.file
    setCurrentSpecFile(suiteStats.file)

    // Push title if non-empty
    if (suiteStats.title) {
      this.#suitePath.push(suiteStats.title)
    }

    // Enrich and set callSource for suites
    mapSuiteToSource(suiteStats as any, this.#currentSpecFile, this.#suitePath)
    if ((suiteStats as any).file && (suiteStats as any).line !== null) {
      ;(suiteStats as any).callSource =
        `${(suiteStats as any).file}:${(suiteStats as any).line}`
    }

    this.#sendUpstream()
  }

  onTestStart(testStats: TestStats): void {
    super.onTestStart(testStats)

    // Enrich testStats with callSource info FIRST
    mapTestToSource(testStats, this.#currentSpecFile)
    if ((testStats as any).file && (testStats as any).line !== null) {
      ;(testStats as any).callSource =
        `${(testStats as any).file}:${(testStats as any).line}`
    }

    // Override with stable UID AFTER all metadata is enriched
    const stableUid = generateStableUid(testStats)
    ;(testStats as any).uid = stableUid

    this.#sendUpstream()
  }

  onTestEnd(testStats: TestStats): void {
    super.onTestEnd(testStats)
    this.#sendUpstream()
  }

  onSuiteEnd(suiteStats: SuiteStats): void {
    super.onSuiteEnd(suiteStats)
    // Pop the suite we pushed on start
    if (
      suiteStats.title &&
      this.#suitePath[this.#suitePath.length - 1] === suiteStats.title
    ) {
      this.#suitePath.pop()
    }
    // Only clear when the last suite ends
    if (this.#suitePath.length === 0) {
      this.#currentSpecFile = undefined
      setCurrentSpecFile(undefined)
    }
    this.#sendUpstream()
  }

  #sendUpstream() {
    if (!this.suites) {
      return
    }

    const payload: Record<string, SuiteStats>[] = []

    for (const [uid, suite] of Object.entries(this.suites)) {
      if (suite) {
        payload.push({ [uid]: suite })
      }
    }

    if (payload.length > 0) {
      this.#report(payload)
    }
  }

  get report() {
    return this.suites
  }
}
