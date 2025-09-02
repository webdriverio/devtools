import WebdriverIOReporter, { type SuiteStats, type TestStats } from '@wdio/reporter'

export class TestReporter extends WebdriverIOReporter {
  #report: (data: any) => void

  constructor (options: any, report: (data: any) => void) {
    super(options)
    this.#report = report
  }

  onSuiteStart(suiteStats: SuiteStats): void {
    super.onSuiteStart(suiteStats)
    this.#sendUpstream()
  }

  onTestStart(testStats: TestStats): void {
    super.onTestStart(testStats)
    this.#sendUpstream()
  }

  onTestEnd(testStats: TestStats): void {
    super.onTestEnd(testStats)
    this.#sendUpstream()
  }

  onSuiteEnd(suiteStats: SuiteStats): void {
    super.onSuiteEnd(suiteStats)
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
