import WebdriverIOReporter, { type SuiteStats, type TestStats } from '@wdio/reporter'
import type { SessionCapturer } from './session.ts'

export class TestReporter extends WebdriverIOReporter {
  #sessionCapturer: SessionCapturer

  constructor (options: any, sessionCapturer: SessionCapturer) {
    super(options)
    this.#sessionCapturer = sessionCapturer
  }

  onSuiteStart(suiteStats: SuiteStats): void {
    super.onSuiteStart(suiteStats)
    this.#sessionCapturer.sendUpstream('suites', [this.suites])
  }

  onTestStart(testStats: TestStats): void {
    super.onTestStart(testStats)
    this.#sessionCapturer.sendUpstream('suites', [this.suites])
  }

  onTestEnd(testStats: TestStats): void {
    super.onTestEnd(testStats)
    this.#sessionCapturer.sendUpstream('suites', [this.suites])
  }

  onSuiteEnd(suiteStats: SuiteStats): void {
    super.onSuiteEnd(suiteStats)
    this.#sessionCapturer.sendUpstream('suites', [this.suites])
  }

  get report () {
    return this.suites
  }
}
