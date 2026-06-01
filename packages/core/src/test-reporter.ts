import type { SuiteStats, TestStats } from '@wdio/devtools-shared'
import { resetSignatureCounters } from './uid.js'

/**
 * Shape of the payload sent upstream — one record per suite, keyed by UID,
 * so the UI can merge it into its existing suite map without scanning.
 */
export type ReporterUpstreamPayload = Record<string, SuiteStats>[]
export type ReporterUpstream = (data: ReporterUpstreamPayload) => void

/**
 * Foundation class for adapter TestReporters. Owns the cross-framework
 * scaffolding (suite collection, upstream batching). Framework-specific
 * lifecycle hooks (spec-file scanning, UID generation, skipped-test
 * synthesis) stay in subclasses.
 *
 * Service uses the WDIO reporter base instead — this class is for adapters
 * that own their own reporter lifecycle (nightwatch, selenium).
 */
export abstract class TestReporterBase {
  #report: ReporterUpstream
  protected allSuites: SuiteStats[] = []

  constructor(report: ReporterUpstream) {
    this.#report = report
    resetSignatureCounters()
  }

  /** Swap the upstream sink, e.g. after a WS reconnect. */
  updateUpstream(report: ReporterUpstream): void {
    this.#report = report
  }

  /** Manually trigger a flush of current state to the UI. */
  updateSuites(): void {
    this.sendUpstream()
  }

  /**
   * Reset collected state. Subclasses with extra state (test-name cache,
   * current-suite ref) override and call `super.clearExecutionData()` first.
   */
  clearExecutionData(): void {
    this.allSuites = []
    resetSignatureCounters()
  }

  /** Default: find by `uid`, replace in place. */
  onTestEnd(test: TestStats): void {
    for (const suite of this.allSuites) {
      const idx = suite.tests.findIndex(
        (t) => typeof t !== 'string' && t.uid === test.uid
      )
      if (idx !== -1) {
        suite.tests[idx] = test
        break
      }
    }
    this.sendUpstream()
  }

  /** Default: just flush. Subclasses with skipped-test synthesis override. */
  onSuiteEnd(_suite: SuiteStats): void {
    this.sendUpstream()
  }

  get report(): SuiteStats[] {
    return this.allSuites
  }

  /**
   * Flush current suite state to the upstream callback. Empty-payload guard
   * matches the existing adapter behavior — UI shouldn't receive an empty
   * array.
   */
  protected sendUpstream(): void {
    const payload: ReporterUpstreamPayload = []
    for (const suite of this.allSuites) {
      if (suite.uid) {
        payload.push({ [suite.uid]: suite })
      }
    }
    if (payload.length > 0) {
      this.#report(payload)
    }
  }
}
