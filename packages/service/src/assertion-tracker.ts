// Owns the expect-webdriverio matcher lifecycle for the WDIO worker: the matcher
// nesting depth and the pending-matcher state machine that turns a matcher call
// into a single trace row. Pure CommandLog shaping lives in ./assert-capture.

import logger from '@wdio/logger'
import { errorMessage } from '@wdio/devtools-core'
import type { ActionSnapshot } from '@wdio/devtools-shared'
import {
  captureExpectFailure,
  expectAssertionToCommandLog,
  isMatcherReadCommand,
  type ExpectAssertion
} from './assert-capture.js'
import { pushActionSnapshotAt } from './action-snapshot.js'
import { isNativeMobile } from './mobile.js'
import type { SessionCapturer } from './session.js'
import type { ServiceOptions } from './types.js'

const log = logger('@wdio/devtools-service:assertion-tracker')

/** Live accessors into the owning service's state. The capturer is replaced in
 *  before() and the browser/test uid change per test, so each is read lazily. */
export interface AssertionTrackerContext {
  getCapturer: () => SessionCapturer
  getBrowser: () => WebdriverIO.Browser | undefined
  getTestUid: () => string | undefined
  getStepUid: () => string | undefined
  options: ServiceOptions
  actionSnapshots: ActionSnapshot[]
}

interface PendingAssertion {
  matcherName: string
  expectedValue?: unknown
  testUid?: string
  stepUid?: string
}

export class AssertionTracker {
  #ctx: AssertionTrackerContext

  /** expect-webdriverio matcher nesting depth. Aliases fire before/afterAssertion
   *  twice (toBeChecked→toBeSelected), so only the outermost pair owns the row. */
  #assertionDepth = 0

  /** Matcher armed at beforeAssertion, cleared at its afterAssertion. It survives
   *  to test end only when the matcher hard-threw (element never resolved, so
   *  waitUntil rethrew and afterAssertion never fired) — then it's synthesized as
   *  a failing expect.<matcher> row instead of leaving a raw read. */
  #pendingAssertion?: PendingAssertion

  constructor(ctx: AssertionTrackerContext) {
    this.#ctx = ctx
  }

  /** Clear per-test matcher state; called from the service's resetStack. */
  reset(): void {
    this.#assertionDepth = 0
    this.#pendingAssertion = undefined
  }

  /**
   * expect-webdriverio fires this at the START of every matcher, before it polls
   * — so it fires even for a matcher that later hard-throws (element never
   * resolved), unlike afterAssertion. Arm the pending matcher here so test-end
   * can synthesize its expect row if afterAssertion never comes. Depth-counted:
   * aliases (toBeChecked→toBeSelected) fire this twice, so only the outermost
   * arms the row.
   */
  beforeAssertion(params: {
    matcherName: string
    expectedValue?: unknown
  }): void {
    if (this.#ctx.options.captureAssertions === false) {
      return
    }
    if (this.#assertionDepth === 0) {
      this.#pendingAssertion = {
        matcherName: params.matcherName,
        expectedValue: params.expectedValue,
        testUid: this.#ctx.getTestUid(),
        stepUid: this.#ctx.getStepUid()
      }
    }
    this.#assertionDepth++
  }

  /**
   * expect-webdriverio fires this after each matcher evaluates, with the matcher
   * name + pass/fail + expected value. The matcher's value-read (getText /
   * isExisting / …) was captured as a normal command; fold this assertion into
   * that read so one `expect.<matcher>` row remains — inheriting the read's real
   * callSource, screenshot, and timeline position. Deterministic and anchored to
   * this reliable hook: no `#assertionDepth`, no stack-frame detection.
   */
  async afterAssertion(params: ExpectAssertion): Promise<void> {
    if (this.#ctx.options.captureAssertions === false) {
      return
    }
    this.#assertionDepth = Math.max(0, this.#assertionDepth - 1)
    // Inner matcher of a nested pair (toBeChecked→toBeSelected): the outer
    // afterAssertion owns the row.
    if (this.#assertionDepth > 0) {
      return
    }
    // Reached afterAssertion → the matcher resolved (pass or value-fail), so no
    // hard-throw synthesis is needed at test end.
    this.#pendingAssertion = undefined
    const capturer = this.#ctx.getCapturer()
    const entry = expectAssertionToCommandLog(params, this.#ctx.getTestUid())
    entry.stepUid = this.#ctx.getStepUid()
    if (capturer.coalesceAssertionIntoLastRead(entry, isMatcherReadCommand)) {
      return
    }
    // No matcher read to fold into (a value matcher like toBe(x), or the read
    // hard-threw): emit a fresh row with its own screenshot + trace snapshot.
    const browser = this.#ctx.getBrowser()
    if (browser && !isNativeMobile(browser)) {
      try {
        entry.screenshot = await browser.takeScreenshot()
      } catch (err) {
        // best-effort: a missing screenshot must not fail the assertion hook
        log.debug(`assertion screenshot skipped: ${errorMessage(err)}`)
      }
    }
    if (this.#ctx.options.mode === 'trace' && browser) {
      await pushActionSnapshotAt(
        browser,
        entry.command,
        entry.timestamp,
        this.#ctx.actionSnapshots
      )
    }
    capturer.captureAssertCommand(entry)
  }

  /** Route a test/step failure to assertion capture. A matcher that hard-threw
   *  (element never resolved) left an armed pendingAssertion because
   *  afterAssertion never fired — synthesize its failing expect row. Any other
   *  failure just marks the last action with the error. */
  handleOutcome(error: unknown): void {
    if (this.#ctx.options.captureAssertions === false) {
      return
    }
    if (this.#pendingAssertion) {
      this.#finalizePendingAssertion(error)
      return
    }
    this.#captureExpectFailure(error)
  }

  /** Mark the failing action from a matcher error (afterStep for Cucumber,
   *  afterTest for Mocha route here). */
  #captureExpectFailure(error: unknown): void {
    captureExpectFailure(
      this.#ctx.getCapturer(),
      this.#ctx.getTestUid(),
      error,
      this.#ctx.options.captureAssertions !== false
    )
  }

  /** Synthesize the failing expect.<matcher> row for a hard-thrown matcher: fold
   *  it into the throwing read (relabel `getText`→`expect.toHaveText`, keeping
   *  the error) so the assertion renders consistently whether or not the element
   *  resolved; fall back to a fresh row when there is no read to fold. */
  #finalizePendingAssertion(error: unknown): void {
    const pending = this.#pendingAssertion
    this.#pendingAssertion = undefined
    this.#assertionDepth = 0
    if (!pending) {
      return
    }
    const message = errorMessage(error) || `${pending.matcherName} failed`
    const entry = expectAssertionToCommandLog(
      {
        matcherName: pending.matcherName,
        expectedValue: pending.expectedValue,
        result: { pass: false, message: () => message }
      },
      pending.testUid
    )
    entry.stepUid = pending.stepUid
    const capturer = this.#ctx.getCapturer()
    if (
      capturer.coalesceAssertionIntoLastRead(entry, isMatcherReadCommand, true)
    ) {
      return
    }
    capturer.captureAssertCommand(entry)
  }
}
