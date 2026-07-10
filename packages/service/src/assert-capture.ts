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
import { parse } from 'stack-trace'
import {
  resolveCallSourceFromFrame,
  resolveFilePathFromFrame
} from './call-source.js'
import { isUserSpecFile } from './utils.js'
import type { SessionCapturer } from './session.js'

const log = logger('@wdio/devtools-service:assert-capture')

/**
 * Capture the user's `expect()` call site from the SYNCHRONOUS stack at matcher
 * entry (call from `beforeAssertion`). The matcher then runs async, so this is
 * the only point a user frame is still on the stack — reading it in
 * `afterAssertion` resolves to the service bundle instead. Mirrors
 * `beforeCommand`'s resolver (`parse(new Error()).reverse()` → first user-spec
 * frame → `resolveCallSourceFromFrame`) so assertion rows share regular
 * commands' Source-tab behaviour. Also loads that file's source via
 * `captureSource` so the tab renders. Returns `undefined` when no user frame is
 * present (row falls back to no callSource, exactly as before this fix).
 */
export function resolveAssertionCallSource(
  captureSource: (filePath: string) => void
): string | undefined {
  Error.stackTraceLimit = 20
  const frame = parse(new Error(''))
    .reverse()
    .find((f) => isUserSpecFile(f.getFileName()))
  if (!frame) {
    return undefined
  }
  const filePath = resolveFilePathFromFrame(frame)
  if (filePath) {
    captureSource(filePath)
  }
  return resolveCallSourceFromFrame(frame)
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

/**
 * Adapt expect-webdriverio's afterAssertion params to the shared matcher
 * converter. Framework-specific extraction only (matcher name, expectedValue →
 * args, the runtime `pass` vs typed `result` flag); the actual CommandLog
 * shaping lives once in core's `matcherAssertionToCommandLog`. `callSource` is
 * the user's `expect()` call site captured in `beforeAssertion` (the matcher
 * runs async, so afterAssertion's own stack no longer holds a user frame) — it
 * makes the row's Source tab point at the spec, not the service bundle.
 */
export function expectAssertionToCommandLog(
  params: ExpectAssertion,
  testUid: string | undefined,
  callSource?: string
): CommandLog {
  const { matcherName, expectedValue, result } = params
  return matcherAssertionToCommandLog(
    {
      method: matcherName,
      args:
        expectedValue === undefined
          ? []
          : Array.isArray(expectedValue)
            ? expectedValue
            : [expectedValue],
      passed: result.pass ?? result.result ?? false,
      message: result.message,
      callSource
    },
    testUid
  )
}
