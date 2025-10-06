import WebdriverIOReporter, { type SuiteStats, type TestStats } from '@wdio/reporter'
import { enrichTestStats, setCurrentSpecFile } from './utils.js'

export class TestReporter extends WebdriverIOReporter {
  #report: (data: any) => void
  #currentSpecFile?: string

  constructor (options: any, report: (data: any) => void) {
    super(options)
    this.#report = report
  }

  onSuiteStart(suiteStats: SuiteStats): void {
    super.onSuiteStart(suiteStats)
    this.#currentSpecFile = suiteStats.file
    setCurrentSpecFile(suiteStats.file)
    this.#sendUpstream()
  }

  onTestStart(testStats: TestStats): void {
    //Enrich testStats with file + line info
    enrichTestStats(testStats, this.#currentSpecFile)
    if ((testStats as any).file && (testStats as any).line != null) {
      ;(testStats as any).callSource = `${(testStats as any).file}:${(testStats as any).line}`
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
    this.#currentSpecFile = undefined
    setCurrentSpecFile(undefined)
    this.#sendUpstream()
  }

  #sendUpstream () {
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

  get report () {
    return this.suites
  }
}
