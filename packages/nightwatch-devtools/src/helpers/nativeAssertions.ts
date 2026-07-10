// Native-assertion capture: turns explicit `browser.assert.*` /
// `browser.verify.*` calls into concise trace/UI action rows with real args,
// a clickable source location, and pass/fail colour — streamed LIVE.
//
// Nightwatch exposes no per-assertion hook, and its test-end
// `currentTest.results` carries no source location for PASSING assertions
// (results.assertions[i].stackTrace is '' on pass) and only stringified args.
// So each explicit call is intercepted at CALL TIME
// (BrowserProxy.wrapAssertionNamespaces): a neutral "pending" row is emitted
// immediately (concise title, real args, callSource) so rows stream in one by
// one like normal commands. At TEST END the pass/fail truth + verbose failure
// message are read from results.assertions and the already-emitted row is
// UPDATED IN PLACE (same stable id) — never re-created, so no duplicates.
// Iterating the recorded calls (not results.assertions) also excludes
// Nightwatch's implicit command-generated assertions (e.g.
// waitForElementVisible's "element was visible" entry).

import logger from '@wdio/logger'
import {
  matcherAssertionToCommandLog,
  safeSerializeAssertArg,
  stripAnsi
} from '@wdio/devtools-core'
import type { SessionCapturer } from '../session.js'
import type {
  CommandLog,
  NativeAssertCall,
  NightwatchBrowser,
  NightwatchCurrentTest
} from '../types.js'

const log = logger('@wdio/nightwatch-devtools:nativeAssertions')

/**
 * One entry Nightwatch pushes to `results.assertions` (from
 * `NightwatchAssertion.getAssertResult`, lib/assertion/assertion.js). Carries
 * only a human message — no method/args. `failure === false` is the reliable
 * pass signal; any truthy `failure` (message string, or `true`) means failed.
 */
interface NwAssertionEntry {
  message?: string
  fullMsg?: string
  failure?: string | boolean
}

/** One entry Nightwatch pushes to `results.commands` (lib/reporter/index.js
 *  logCommandResult). For an assert/verify `name` is the namespaced method and
 *  `startTime`/`endTime` are the real queue-execution window in ms
 *  (treenode.js). Read only to position the finalized row on the timeline. */
interface NwCommandEntry {
  name?: string
  startTime?: number
  endTime?: number
}

const ASSERT_CMD_RE = /^(assert|verify)\.\w+$/

/** Real per-assertion execution windows, in call order, aligned to `count`
 *  recorded calls. Nightwatch enqueues assertions synchronously (all at once)
 *  but runs them later one at a time, so the enqueue timestamp clusters the
 *  rows; this recovers each row's true execution time so the trace timeline
 *  spreads them out. Returns `null` per slot when the executed-command count
 *  doesn't line up (e.g. retries) — the enqueue timestamp is kept then. */
function assertCommandTimings(
  commands: NwCommandEntry[],
  count: number
): Array<{ startTime: number; endTime: number } | null> {
  const executed = commands.filter(
    (c) => typeof c?.name === 'string' && ASSERT_CMD_RE.test(c.name)
  )
  if (executed.length !== count) {
    return new Array(count).fill(null)
  }
  return executed.map((c) =>
    typeof c.startTime === 'number' && typeof c.endTime === 'number'
      ? { startTime: c.startTime, endTime: c.endTime }
      : null
  )
}

/** Nightwatch embeds the assertion arguments in the message text
 *  (AssertionInstance.initialize → Logger.formatMessage), so a passing entry
 *  for `titleContains('Example')` reads "Testing if the page title contains
 *  'Example'". Match a call to its result entry when every string/number arg
 *  appears in the message. */
function messageMatchesArgs(entry: NwAssertionEntry, args: unknown[]): boolean {
  const text = String(entry.fullMsg ?? entry.message ?? '')
  const literals = args.filter(
    (a): a is string | number => typeof a === 'string' || typeof a === 'number'
  )
  return literals.length > 0 && literals.every((a) => text.includes(String(a)))
}

interface Outcome {
  passed: boolean
  message: string
}

/**
 * Pair each recorded call with its `results.assertions` entry for pass/fail +
 * verbose message. Both lists are in call/execution order and each explicit
 * call produces exactly one assertion entry, so: match by args-in-message
 * first (most specific, skips interleaved implicit entries), then fall back to
 * the next unconsumed entry positionally. A call with no matching entry left
 * (never happens for a real assertion) is dropped (`null`).
 */
function correlate(
  calls: NativeAssertCall[],
  assertions: NwAssertionEntry[]
): Array<Outcome | null> {
  const consumed = new Array(assertions.length).fill(false)
  const toOutcome = (idx: number): Outcome => {
    consumed[idx] = true
    const entry = assertions[idx]
    return {
      passed: !entry.failure,
      message: stripAnsi(String(entry.fullMsg ?? entry.message ?? '')).trim()
    }
  }
  const matched = calls.map((call) => {
    const idx = assertions.findIndex(
      (entry, i) => !consumed[i] && messageMatchesArgs(entry, call.args)
    )
    return idx === -1 ? null : toOutcome(idx)
  })
  return matched.map((outcome) => {
    if (outcome) {
      return outcome
    }
    const idx = consumed.findIndex((used) => !used)
    return idx === -1 ? null : toOutcome(idx)
  })
}

/** Last already-resolved screenshot in the command log — the DOM the assertion
 *  evaluated against (title/most asserts don't mutate it). Synchronous, so it's
 *  usable from the call-time wrapper. */
export function latestResolvedScreenshot(
  capturer: SessionCapturer
): string | null {
  for (let i = capturer.commandsLog.length - 1; i >= 0; i--) {
    const shot = capturer.commandsLog[i]?.screenshot
    if (shot) {
      return shot
    }
  }
  return null
}

/** Reuse the nearest preceding command's screenshot; if the fire-and-forget
 *  capture hasn't resolved yet (race), fall back to a fresh end-of-test one. */
async function resolveAssertionScreenshot(
  capturer: SessionCapturer,
  browser: NightwatchBrowser
): Promise<string | null> {
  return (
    latestResolvedScreenshot(capturer) ??
    (await capturer.takeScreenshotViaHttp(browser))
  )
}

/** `assert.titleContains('SOFT_FAIL_ME')` — the concise row label. Strings are
 *  quoted, objects elided; never the verbose failure message. */
function conciseTitle(call: NativeAssertCall): string {
  const preview = call.args
    .map((a) =>
      typeof a === 'string'
        ? `'${a}'`
        : a !== null && typeof a === 'object'
          ? '…'
          : String(a)
    )
    .join(', ')
  return `${call.prefix}.${call.method}(${preview})`
}

/**
 * Build the neutral "pending" row emitted the moment an assert/verify is
 * called — everything known at call time (concise title, real args, callSource,
 * screenshot) but NO result/error yet, so it renders neutral (not red/green)
 * and streams in like a normal in-flight command. `startTime`/`timestamp` are
 * the call time; the row is finalized in place later by
 * {@link captureNativeAssertions}.
 */
export function pendingAssertionCommand(
  call: NativeAssertCall,
  testUid: string | undefined,
  screenshot: string | null
): CommandLog {
  const entry: CommandLog = {
    command: `${call.prefix}.${call.method}`,
    args: call.args.map(safeSerializeAssertArg),
    title: conciseTitle(call),
    timestamp: call.timestamp,
    startTime: call.timestamp
  }
  if (call.callSource) {
    entry.callSource = call.callSource
  }
  if (testUid) {
    entry.testUid = testUid
  }
  if (screenshot) {
    entry.screenshot = screenshot
  }
  return entry
}

/** Update one streamed pending row in place: apply pass/fail + verbose error,
 *  a screenshot, and its real execution window, then re-broadcast by stable id. */
function finalizeAssertionRow(
  capturer: SessionCapturer,
  call: NativeAssertCall,
  outcome: Outcome,
  timing: { startTime: number; endTime: number } | null,
  screenshot: string | null,
  testUid: string | undefined
): void {
  const entry = call.entry!
  const finalized = matcherAssertionToCommandLog(
    {
      prefix: call.prefix,
      method: call.method,
      args: call.args,
      passed: outcome.passed,
      message: outcome.message || `${call.prefix}.${call.method} failed`,
      callSource: call.callSource,
      title: entry.title
    },
    testUid
  )
  entry.result = finalized.result
  entry.error = finalized.error
  if (!entry.screenshot && screenshot) {
    entry.screenshot = screenshot
  }
  // Reposition the row on its REAL execution window (Nightwatch enqueues all
  // asserts at once, so the emit/enqueue timestamp clustered them). The row is
  // matched for replacement by its stable id, so the old enqueue timestamp is
  // what the UI still keys on until this swap lands.
  const oldTimestamp = entry.timestamp
  if (timing) {
    entry.startTime = timing.startTime
    entry.timestamp =
      timing.endTime > timing.startTime ? timing.endTime : timing.startTime
  }
  capturer.sendReplaceCommand(oldTimestamp, entry)
  log.info(`[assert] ${entry.title} → ${outcome.passed ? 'pass' : 'fail'}`)
}

/**
 * Finalize the streamed pending rows at test-end: correlate the recorded calls
 * with `results.assertions`, then UPDATE each row's `entry` in place with
 * pass/fail (`result`) + the verbose failure message (`error`, failures only)
 * + a screenshot + its real execution window, and re-broadcast via
 * `sendReplaceCommand` keyed on the row's stable id. No new rows are created
 * (no duplicates); a call with no matching result is left pending (defensive).
 */
export async function captureNativeAssertions(
  capturer: SessionCapturer,
  browser: NightwatchBrowser,
  currentTest: NightwatchCurrentTest | undefined,
  testUid: string | undefined,
  calls: NativeAssertCall[]
): Promise<void> {
  if (calls.length === 0) {
    return
  }
  // Boundary cast: `results` is Nightwatch's loosely-typed per-test bag; we read
  // only the assertions + commands arrays whose shapes are documented above.
  const results = currentTest?.results as
    | { assertions?: NwAssertionEntry[]; commands?: NwCommandEntry[] }
    | undefined
  const assertions = Array.isArray(results?.assertions)
    ? results.assertions
    : []
  const outcomes = correlate(calls, assertions)
  const timings = assertCommandTimings(
    Array.isArray(results?.commands) ? results.commands : [],
    calls.length
  )
  // One shared screenshot for all rows — same DOM, ran consecutively.
  const screenshot = await resolveAssertionScreenshot(capturer, browser)

  calls.forEach((call, index) => {
    const outcome = outcomes[index]
    // Leave an unmatched (or never-emitted) row in its last state.
    if (call.entry && outcome) {
      finalizeAssertionRow(
        capturer,
        call,
        outcome,
        timings[index],
        screenshot,
        testUid
      )
    }
  })
}
