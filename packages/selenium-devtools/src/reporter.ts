import logger from '@wdio/logger'
import { resetSignatureCounters } from './helpers/utils.js'
import type { SuiteStats, TestStats } from './types.js'

const log = logger('@wdio/selenium-devtools:Reporter')

/**
 * Aggregates suite/test state and pushes it to the UI via the supplied
 * upstream callback. The shape of each upstream payload is identical to the
 * Nightwatch plugin so the existing UI renders both transparently.
 */
export class TestReporter {
  #report: (data: any) => void
  #allSuites: SuiteStats[] = []

  constructor(report: (data: any) => void) {
    this.#report = report
    resetSignatureCounters()
  }

  updateUpstream(report: (data: any) => void) {
    this.#report = report
  }

  onSuiteStart(suite: SuiteStats) {
    if (!this.#allSuites.find((s) => s.uid === suite.uid)) {
      this.#allSuites.push(suite)
    }
    this.#sendUpstream()
  }

  onSuiteEnd(_suite: SuiteStats) {
    this.#sendUpstream()
  }

  onTestStart(test: TestStats) {
    for (const suite of this.#allSuites) {
      if (suite.uid !== test.parent) {
        continue
      }
      const idx = suite.tests.findIndex(
        (t) => typeof t !== 'string' && t.uid === test.uid
      )
      if (idx !== -1) {
        suite.tests[idx] = test
      }
    }
    this.#sendUpstream()
  }

  onTestEnd(test: TestStats) {
    for (const suite of this.#allSuites) {
      const idx = suite.tests.findIndex(
        (t) => typeof t !== 'string' && t.uid === test.uid
      )
      if (idx !== -1) {
        suite.tests[idx] = test
      }
    }
    this.#sendUpstream()
  }

  updateSuites() {
    this.#sendUpstream()
  }

  clearExecutionData() {
    this.#allSuites = []
    resetSignatureCounters()
    log.info('Cleared execution data')
  }

  #sendUpstream() {
    const payload: Record<string, SuiteStats>[] = []
    for (const suite of this.#allSuites) {
      if (suite.uid) {
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
