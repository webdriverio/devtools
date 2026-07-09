import logger from '@wdio/logger'
import {
  createTestStats,
  stampTestEnd,
  TestAttemptTracker
} from '@wdio/devtools-core'
import { DEFAULTS, TEST_STATE } from '../constants.js'
import type { SuiteStats, TestStats } from '../types.js'
import type { TestReporter } from '../reporter.js'
import type { SuiteManager } from './suiteManager.js'
import { deterministicUid, generateStableUid } from './utils.js'

const log = logger('@wdio/selenium-devtools:testManager')

/**
 * Tracks the currently-active test inside the session suite. Two modes:
 *   - `session` (default): one synthetic test wraps the entire driver session.
 *   - `marked`: user calls startTest(name)/endTest(state); each pair adds a test.
 *
 * The proxy reads `getCurrentTest()` to tag each captured command with a uid.
 */
export class TestManager {
  #currentTest: TestStats | null = null
  #lastMarkedTest: TestStats | null = null
  #mode: 'session' | 'marked' = 'session'
  // Per-test attempt counter. Persists for the whole in-process session so
  // same-process retries (Mocha/Jest/etc re-entering the start hook) accumulate.
  #attemptTracker = new TestAttemptTracker()
  /** Set true the first time the user calls startMarkedTest. Once true we
   * never auto-create the synthetic session test — orphan commands attach
   * to the most-recently-marked test instead. */
  #userTookOver = false

  constructor(
    private rootSuite: SuiteStats,
    private testReporter: TestReporter,
    private suiteManager: SuiteManager
  ) {}

  /** Where new tests attach — current scenario sub-suite (Cucumber) or root. */
  private get suite(): SuiteStats {
    return this.suiteManager.getCurrentParent() ?? this.rootSuite
  }

  /**
   * Returns the test that captured commands should attach to. Order:
   *   1. The currently-running marked test, if any.
   *   2. (only if the user has NOT yet used startMarkedTest) the synthetic
   *      session-wide test, lazily created on first command.
   *   3. The most-recently-ended marked test (handles commands that fire
   *      between the user's it() blocks — chromedriver retries, hooks, etc).
   */
  getOrEnsureTest(): TestStats | null {
    if (this.#currentTest) {
      return this.#currentTest
    }
    if (!this.#userTookOver) {
      return this.#ensureSessionTest()
    }
    return this.#lastMarkedTest
  }

  /** Lazily creates the synthetic session-wide test on first command. */
  #ensureSessionTest(): TestStats {
    if (this.#currentTest && this.#mode === 'session') {
      return this.#currentTest
    }

    log.info('Creating synthetic session test (no startTest called yet)')
    const title = DEFAULTS.SESSION_TITLE
    const test = createTestStats({
      uid: deterministicUid(this.suite.file, `session:${this.suite.uid}`),
      cid: DEFAULTS.CID,
      title,
      file: this.suite.file,
      parent: this.suite.uid
    })
    this.suite.tests.push(test)
    this.#currentTest = test
    this.testReporter.onTestStart(test)
    return test
  }

  /**
   * Public alias retained for callers that want to force the synthetic test
   * to exist. The internal code path uses `getOrEnsureTest()` instead.
   */
  ensureSessionTest(): TestStats {
    return this.#ensureSessionTest()
  }

  /**
   * Switch into marked mode and start a new test. The first time this is
   * called, any pre-existing synthetic session test is removed from the suite
   * (along with any commands that referenced it) — once the user takes over
   * the test boundaries, the synthetic just adds noise.
   */
  startMarkedTest(
    name: string,
    opts: { file?: string; callSource?: string; attempt?: number } = {}
  ): TestStats {
    if (!this.#userTookOver) {
      this.#userTookOver = true
      // Drop the synthetic session test if it was lazy-created during the
      // gap between driver creation and the user's first startTest. Any
      // commands captured against it stay on disk in the worker buffer but
      // are no longer reachable from the suite tree — cleaner UI.
      if (this.#currentTest && this.#mode === 'session') {
        log.info('Removing synthetic session test (user has taken over)')
        const idx = this.suite.tests.indexOf(this.#currentTest)
        if (idx !== -1) {
          this.suite.tests.splice(idx, 1)
        }
        this.#currentTest = null
      }
    }
    if (this.#mode === 'marked' && this.#currentTest) {
      this.endCurrent('passed')
    }

    this.#mode = 'marked'
    const file = opts.file || this.suite.file
    // Scope by parent so two suites with the same test/step name don't
    // collide on signatureCounter disambiguation across rerun processes.
    const signature = `${this.suite.uid}::${name}`
    const test = createTestStats({
      uid: generateStableUid(file, signature),
      cid: DEFAULTS.CID,
      title: name,
      file,
      parent: this.suite.uid,
      callSource: opts.callSource
    })
    // deterministicUid is retry-stable (no counter), so re-entering with the
    // same logical test increments the heuristic. Mocha supplies an
    // authoritative per-test retry index via opts.attempt; prefer it.
    const heuristicAttempt = this.#attemptTracker.recordStart(
      deterministicUid(file, signature)
    )
    test.retries = opts.attempt ?? heuristicAttempt
    log.info(
      `Started marked test "${name}" (callSource: ${opts.callSource || 'n/a'})`
    )
    this.suite.tests.push(test)
    this.#currentTest = test
    this.#lastMarkedTest = test
    this.testReporter.onTestStart(test)
    return test
  }

  endCurrent(state: TestStats['state']): void {
    const test = this.#currentTest
    if (!test) {
      return
    }
    test.state = state
    stampTestEnd(test)
    this.testReporter.onTestEnd(test)
    this.#currentTest = null
  }

  getCurrentTest(): TestStats | null {
    return this.#currentTest
  }

  /** Called when the driver session is closing (process exit / quit). */
  finalizeSession(): void {
    if (this.#currentTest) {
      this.endCurrent(
        this.#currentTest.state === TEST_STATE.RUNNING
          ? 'passed'
          : this.#currentTest.state
      )
    }
  }
}
