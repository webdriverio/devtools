// Assertion capture wiring for the WDIO worker: node:assert patching plus
// marking the failing action when an expect-webdriverio matcher throws.

import logger from '@wdio/logger'
import {
  capturedAssertToCommandLog,
  matcherAssertionToCommandLog,
  patchNodeAssert,
  stripAnsi
} from '@wdio/devtools-core'
import type { CommandLog, SerializedError } from '@wdio/devtools-shared'
import type { SessionCapturer } from './session.js'

const log = logger('@wdio/devtools-service:assert-capture')

/**
 * The WDIO element/browser query commands an expect-webdriverio matcher issues
 * to read the value it asserts on (`toHaveText`→`getText`, `toExist`→
 * `isExisting`, …). The matcher's read is captured as a normal command; on
 * `afterAssertion` the synthesized `expect.*` row is coalesced into it (it
 * already carries the correct callSource, screenshot, and timeline position),
 * so only one row remains — no timing/stack heuristics. Not exhaustive: an
 * unlisted matcher just leaves its read visible plus the assertion row.
 */
const MATCHER_READ_COMMANDS = new Set([
  'getText',
  'getHTML',
  'isExisting',
  'isDisplayed',
  'isDisplayedInViewport',
  'getValue',
  'getAttribute',
  'getProperty',
  'getComputedRole',
  'getComputedLabel',
  'isEnabled',
  'isClickable',
  'isSelected',
  'isFocused',
  'getSize',
  'getLocation',
  'getCSSProperty',
  'getTagName',
  'getUrl',
  'getTitle'
])

/** True when a command is a matcher's value-read (see MATCHER_READ_COMMANDS). */
export function isMatcherReadCommand(command: string): boolean {
  return MATCHER_READ_COMMANDS.has(command)
}

/**
 * Patch node:assert so every tracked assertion lands in the session capturer
 * as a command. Getters are read at capture time — the capturer instance is
 * replaced in `before()` and the test UID changes per test.
 */
export function wireAssertCapture(
  getCapturer: () => SessionCapturer,
  getTestUid: () => string | undefined
): void {
  patchNodeAssert(
    (cmd) =>
      getCapturer().captureAssertCommand(
        capturedAssertToCommandLog(cmd, getTestUid())
      ),
    (level, message) => log[level](message)
  )
}

/**
 * Normalize a framework failure into a SerializedError. Cucumber hands a plain
 * message string (@wdio/cucumber-framework getResultObject → world.result.message);
 * Mocha/Jasmine hand an Error object. Returns undefined when there's nothing to
 * show, or when the failure was already captured as its own command: a
 * node:assert AssertionError (via the patcher) or an expect-webdriverio matcher
 * error (via afterAssertion — it carries `matcherResult`). Skipping those keeps
 * `failLastAction` from double-marking a passing command. ANSI is stripped.
 */
export function toCommandError(error: unknown): SerializedError | undefined {
  if (!error) {
    return undefined
  }
  if (typeof error === 'string') {
    const message = stripAnsi(error).trim()
    return message ? { name: 'Error', message } : undefined
  }
  if (typeof error !== 'object') {
    return undefined
  }
  const err = error as {
    name?: string
    message?: string
    stack?: string
    matcherResult?: unknown
  }
  if (err.name === 'AssertionError' || err.matcherResult !== undefined) {
    return undefined
  }
  return {
    name: err.name || 'Error',
    message: stripAnsi(err.message || String(error)),
    ...(err.stack ? { stack: stripAnsi(err.stack) } : {})
  }
}

/**
 * Mark the action that was running when an expect-webdriverio matcher failed
 * (the assertion isn't its own command, so its query carries the error). No-op
 * when assertion capture is disabled. Mocha calls from afterTest, Cucumber from
 * afterStep.
 */
export function captureExpectFailure(
  capturer: SessionCapturer,
  testUid: string | undefined,
  error: unknown,
  enabled: boolean
): void {
  if (!enabled) {
    return
  }
  const commandError = toCommandError(error)
  if (commandError) {
    capturer.failLastAction(testUid, commandError)
  }
}

/** The subset of expect-webdriverio's afterAssertion hook params we read to
 *  turn a matcher call into a trace command. The matcher passes `{ pass }` at
 *  runtime, but @wdio/types declares `{ result }`, so we accept and read both. */
export interface ExpectAssertion {
  matcherName: string
  expectedValue?: unknown
  result: { pass?: boolean; result?: boolean; message?: () => string }
}

/** `expect.stringContaining(x)` / `objectContaining` etc. are jest asymmetric
 *  matchers — objects carrying a `sample` payload and an `asymmetricMatch`
 *  method. Surface the payload so a row reads `toHaveText("x")` instead of
 *  `toHaveText({"sample":"x"})`; non-matchers pass through unchanged. */
function unwrapAsymmetricMatcher(value: unknown): unknown {
  if (
    value !== null &&
    typeof value === 'object' &&
    'sample' in value &&
    typeof (value as { asymmetricMatch?: unknown }).asymmetricMatch ===
      'function'
  ) {
    return (value as { sample: unknown }).sample
  }
  return value
}

/**
 * Adapt expect-webdriverio's afterAssertion params to the shared matcher
 * converter. Framework-specific extraction only (matcher name, expectedValue →
 * args, the runtime `pass` vs typed `result` flag); the CommandLog shaping
 * lives once in core's `matcherAssertionToCommandLog`. The row's callSource +
 * screenshot come from the matcher's read command it's coalesced into (see
 * `coalesceAssertionIntoLastRead`), not from a stack walk here.
 */
/**
 * Whether the matcher was called through `.not`.
 *
 * It has to be read out of the message, because nothing else carries it:
 * `afterAssertion` is handed `{matcherName, options, result}` and the flag
 * lives on the matcher's own `this`. `result.pass` is the RAW matcher answer —
 * jest's convention is that `pass` describes the positive assertion and the
 * framework inverts it for `.not` — so a passing `.not.toBeDisplayed()` arrives
 * as `pass: false` and was recorded as a failed row in a green test.
 *
 * expect-webdriverio builds the message from that same flag: `Expect $(…) not
 * to be displayed`, and `Expected [not]:` labelling the diff. Both are checked
 * because the label is suppressed by its own `useNotInLabel` option.
 */
export function assertionWasNegated(message: string | undefined): boolean {
  if (!message) {
    return false
  }
  return (
    message.includes('Expected [not]') || /\bExpect\b.*\bnot to\b/.test(message)
  )
}

/** The message is a thunk that formats a diff; a matcher whose own formatting
 *  throws must not take the assertion row down with it. */
function readMessage(message?: () => string): string | undefined {
  try {
    return message?.()
  } catch {
    return undefined
  }
}

export function expectAssertionToCommandLog(
  params: ExpectAssertion,
  testUid: string | undefined,
  /** The caller already knows the outcome — a matcher that hard-threw is a
   *  failure whatever its message says. Sniffing it for `.not` could invert a
   *  real failure into a passing row carrying no error. */
  outcomeIsDecided = false
): CommandLog {
  const { matcherName, expectedValue, result } = params
  const rawPass = result.pass ?? result.result ?? false
  const negated =
    !outcomeIsDecided && assertionWasNegated(readMessage(result.message))
  const rawArgs =
    expectedValue === undefined
      ? []
      : Array.isArray(expectedValue)
        ? expectedValue
        : [expectedValue]
  return matcherAssertionToCommandLog(
    {
      method: matcherName,
      args: rawArgs.map(unwrapAsymmetricMatcher),
      // Inverted for `.not`, so a passing negated matcher is a passing row.
      passed: negated ? !rawPass : rawPass,
      message: result.message
    },
    testUid
  )
}
