// Assertion capture wiring for the WDIO worker: node:assert patching plus
// synthesis of a failing `expect` matcher into a CommandLog entry.

import logger from '@wdio/logger'
import {
  capturedAssertToCommandLog,
  patchNodeAssert,
  safeSerializeAssertArg
} from '@wdio/devtools-core'
import type { CommandLog } from './types.js'
import type { SessionCapturer } from './session.js'

const log = logger('@wdio/devtools-service:assert-capture')

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
 * Build a synthetic `expect.<matcher>` entry from a failed test's error so
 * the failing matcher appears in the trace timeline. Returns null when the
 * error isn't matcher-shaped, or when it's a node:assert AssertionError —
 * the assert patcher already captured those (double-capture guard).
 */
export function synthesizeExpectFailure(
  error: unknown,
  testUid: string | undefined
): CommandLog | null {
  if (!error || typeof error !== 'object') {
    return null
  }
  // Boundary cast: WDIO hands the framework error as unknown; only the
  // assertion-library extras are read, by name.
  const err = error as Error & {
    expected?: unknown
    actual?: unknown
    matcherResult?: {
      matcherName?: string
      expected?: unknown
      actual?: unknown
    }
  }
  if (err.name === 'AssertionError') {
    return null
  }
  const matcher = err.matcherResult
  if (!matcher && err.expected === undefined && err.actual === undefined) {
    return null
  }
  const actual = matcher?.actual ?? err.actual
  const expected = matcher?.expected ?? err.expected
  const entry: CommandLog = {
    command: `expect.${matcher?.matcherName || 'assertion'}`,
    args: [actual, expected].map(safeSerializeAssertArg),
    error: {
      name: err.name || 'Error',
      message: err.message || String(error)
    },
    timestamp: Date.now()
  }
  if (testUid) {
    entry.testUid = testUid
  }
  return entry
}
