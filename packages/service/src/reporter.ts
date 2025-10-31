import WebdriverIOReporter, {
  type SuiteStats,
  type TestStats
} from '@wdio/reporter'
import {
  mapTestToSource,
  setCurrentSpecFile,
  mapSuiteToSource
} from './utils.js'

export class TestReporter extends WebdriverIOReporter {
  #report: (data: any) => void
  #currentSpecFile?: string
  #suitePath: string[] = []

  constructor(options: any, report: (data: any) => void) {
    super(options)
    this.#report = report
  }

  onSuiteStart(suiteStats: SuiteStats): void {
    super.onSuiteStart(suiteStats)
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
    // Enrich testStats with callSource info
    mapTestToSource(testStats, this.#currentSpecFile)
    if ((testStats as any).file && (testStats as any).line !== null) {
      ;(testStats as any).callSource =
        `${(testStats as any).file}:${(testStats as any).line}`
    }
    super.onTestStart(testStats)
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
