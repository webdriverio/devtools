import {
  computeSuiteFinalStatePermissive,
  createSuiteStats,
  stampSuiteEnd
} from '@wdio/devtools-core'
import { DEFAULTS } from '../constants.js'
import type { SuiteStats, TestStats } from '../types.js'
import type { TestReporter } from '../reporter.js'
import { generateStableUid } from './utils.js'

// rootSuite = describe block (Mocha/Jest) or feature (Cucumber).
// currentParent points at the in-progress scenario sub-suite for Cucumber,
// or at rootSuite otherwise. Tests append to currentParent.
export class SuiteManager {
  private rootSuite: SuiteStats | null = null
  private currentParent: SuiteStats | null = null

  constructor(private testReporter: TestReporter) {}

  getOrCreateRootSuite(file: string, title: string): SuiteStats {
    if (this.rootSuite) {
      return this.rootSuite
    }

    const suite = createSuiteStats({
      uid: generateStableUid(file, title),
      cid: DEFAULTS.CID,
      title,
      file
    })

    this.rootSuite = suite
    this.currentParent = suite
    this.testReporter.onSuiteStart(suite)
    return suite
  }

  getRootSuite(): SuiteStats | null {
    return this.rootSuite
  }

  /** Where new tests are appended — root suite, or the open scenario sub-suite. */
  getCurrentParent(): SuiteStats | null {
    return this.currentParent ?? this.rootSuite
  }

  /** Open a Cucumber scenario as a sub-suite; steps attach until endScenarioSuite. */
  startScenarioSuite(
    name: string,
    file: string,
    callSource?: string,
    featureFile?: string
  ): SuiteStats | null {
    if (!this.rootSuite) {
      return null
    }
    const sub = createSuiteStats({
      uid: generateStableUid(file, `${this.rootSuite.uid}::${name}`),
      cid: DEFAULTS.CID,
      title: name,
      file,
      callSource,
      featureFile,
      // Without `parent`, the dashboard's `!suite.parent` filter renders this
      // sub-suite at the root too, duplicating it next to the feature.
      parent: this.rootSuite.uid
    })
    this.rootSuite.suites = this.rootSuite.suites ?? []
    this.rootSuite.suites.push(sub)
    this.currentParent = sub
    this.testReporter.onSuiteStart(sub)
    return sub
  }

  endScenarioSuite(state: SuiteStats['state']): void {
    const cur = this.currentParent
    if (!cur || cur === this.rootSuite || cur.end) {
      return
    }
    stampSuiteEnd(cur)
    cur.state = state
    this.testReporter.onSuiteEnd(cur)
    this.currentParent = this.rootSuite
  }

  setRootSuiteTitle(title: string, callSource?: string): void {
    if (!this.rootSuite) {
      return
    }
    let changed = false
    if (title && this.rootSuite.title !== title) {
      this.rootSuite.title = title
      this.rootSuite.fullTitle = title
      changed = true
    }
    if (callSource && this.rootSuite.callSource !== callSource) {
      this.rootSuite.callSource = callSource
      changed = true
    }
    if (changed) {
      this.testReporter.updateSuites()
    }
  }

  addTest(test: TestStats): void {
    const parent = this.getCurrentParent()
    if (!parent) {
      return
    }
    parent.tests.push(test)
    this.testReporter.updateSuites()
  }

  finalize(): void {
    if (!this.rootSuite || this.rootSuite.end) {
      return
    }
    stampSuiteEnd(this.rootSuite)
    this.rootSuite.state = computeSuiteFinalStatePermissive(this.rootSuite)
    this.testReporter.onSuiteEnd(this.rootSuite)
  }

  reset(): void {
    this.rootSuite = null
    this.currentParent = null
  }
}
