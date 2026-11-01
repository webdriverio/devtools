import logger from '@wdio/logger'
import { TestReporterBase } from '@wdio/devtools-core'
import type { SuiteStats, TestStats } from './types.js'

const log = logger('@wdio/selenium-devtools:Reporter')

/**
 * Aggregates suite/test state and pushes it to the UI via the supplied
 * upstream callback. The shape of each upstream payload is identical to the
 * Nightwatch plugin so the existing UI renders both transparently.
 */
export class TestReporter extends TestReporterBase {
  onSuiteStart(suite: SuiteStats): void {
    if (!this.allSuites.find((s) => s.uid === suite.uid)) {
      this.allSuites.push(suite)
    }
    this.sendUpstream()
  }

  onTestStart(test: TestStats): void {
    for (const suite of this.allSuites) {
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
    this.sendUpstream()
  }

  override clearExecutionData(): void {
    super.clearExecutionData()
    log.info('Cleared execution data')
  }
}
