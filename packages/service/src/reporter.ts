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
    const [uid, suite] = Object.entries(this.suites).find(([uid]) => isNaN(parseInt(uid))) || []
    if (uid && suite) {
      this.#report([{ [uid]: suite }])
    }
  }

  get report () {
    return this.suites
  }
}
