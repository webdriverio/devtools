// Native-assertion capture: turns explicit `browser.assert.*` /
// `browser.verify.*` calls into concise trace/UI action rows with real args,
// a clickable source location, and pass/fail colour.
//
// Nightwatch exposes no per-assertion hook. Each explicit call is intercepted
// at CALL TIME (BrowserProxy.wrapAssertionNamespaces) and BUFFERED — concise
// title, real args, callSource, the per-test testUid, and the preceding
// screenshot — but NOT streamed, because streaming a neutral row mid-run would
// render every assert green before its outcome is known. At test-end
// `captureNativeAssertions` reads the pass/fail truth + verbose failure message
// from the results bag and emits each row once, positioned on its real
// execution window (the exporter re-sorts by the buffered call timestamp).
// Correlating the recorded calls (not the raw results) also excludes
// Nightwatch's implicit command-generated assertions (e.g.
// waitForElementVisible's "element was visible" entry).
//
// The plugin `afterEach` fires once per describe-suite (not per `it`), so the
// finalize reads assertions from `results.testcases` (all tests) — see
// gatherResultAssertions.

import logger from '@wdio/logger'
import {
  matcherAssertionToCommandLog,
  safeSerializeAssertArg,
  stripAnsi
} from '@wdio/devtools-core'
import type { SessionCapturer } from '../session.js'
import type {
  CollapsedAssertResult,
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
 * All assertion entries for the suite, in declaration order. Nightwatch's
 * plugin `afterEach` fires once per describe-suite (not per `it`), so the flat
 * `results.assertions` reflects only the last testcase; the full per-test
 * breakdown lives in `results.testcases[title].assertions`. Flattening every
 * testcase's entries lets each buffered call correlate to its own test's
 * outcome (without this, only the last test's asserts get a pass/fail and the
 * rest render neutral). Falls back to the flat list for single-test modules or
 * older Nightwatch that doesn't populate `testcases`.
 */
function gatherResultAssertions(
  results:
    | {
        assertions?: NwAssertionEntry[]
        testcases?: Record<string, { assertions?: unknown[] }>
      }
    | undefined
): NwAssertionEntry[] {
  const testcases = results?.testcases
  if (testcases && typeof testcases === 'object') {
    const all: NwAssertionEntry[] = []
    for (const tc of Object.values(testcases)) {
      if (Array.isArray(tc?.assertions)) {
        all.push(...(tc.assertions as NwAssertionEntry[]))
      }
    }
    if (all.length > 0) {
      return all
    }
  }
  return Array.isArray(results?.assertions) ? results.assertions : []
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

/** Nightwatch failure messages end with `… but got: "<actual>"`. Pull out the
 *  real observed value: Nightwatch passes only the EXPECTED as an arg, so the
 *  actual lives in the message (and only on failure). Undefined when absent.
 *  Uses indexOf + slice (no backtracking-prone regex) on the message tail. */
function parseActualFromMessage(message: string): string | undefined {
  const marker = 'but got:'
  const idx = message.lastIndexOf(marker)
  if (idx === -1) {
    return undefined
  }
  let rest = message.slice(idx + marker.length).trim()
  rest = rest.replace(/ \(\d+ms\)$/, '').trim() // drop trailing "(123ms)"
  rest = rest.replace(/^["']/, '').replace(/["']$/, '').trim() // strip quotes
  return rest || undefined
}

/** Build the collapsed `{passed, expected, actual?, message}` result core's
 *  `buildAssertParams` prefers over the positional `[actual, expected]` arg
 *  convention — which is wrong for Nightwatch, whose asserts pass only the
 *  expected value (`titleContains('x')`), never the actual. */
function collapsedAssertResult(
  call: NativeAssertCall,
  outcome: Outcome
): CollapsedAssertResult {
  const result: CollapsedAssertResult = {
    passed: outcome.passed,
    expected: call.args.length <= 1 ? call.args[0] : call.args,
    message: outcome.message
  }
  const actual = outcome.passed
    ? undefined
    : parseActualFromMessage(outcome.message)
  if (actual !== undefined) {
    result.actual = actual
  }
  return result
}

/** Emit one assertion row at test-end: apply pass/fail + verbose error, a
 *  screenshot, and its real execution window, then send it. Rows are NOT
 *  streamed at call time, so this is the single emit (no neutral pending row). */
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
  // Collapsed object result (not the plain 'passed' string) so the trace's
  // action params show a true actual-vs-expected diff instead of mislabelling
  // Nightwatch's single expected-arg as the actual.
  entry.result = collapsedAssertResult(call, outcome)
  entry.error = finalized.error
  if (!entry.screenshot && screenshot) {
    entry.screenshot = screenshot
  }
  // Position the row on its REAL execution window (Nightwatch enqueues all
  // asserts at once, so the call-time timestamp clustered them). The row was
  // never streamed, so send it now — a single emit with the final outcome.
  if (timing) {
    entry.startTime = timing.startTime
    entry.timestamp =
      timing.endTime > timing.startTime ? timing.endTime : timing.startTime
  }
  capturer.captureAssertCommand(entry)
  log.info(`[assert] ${entry.title} → ${outcome.passed ? 'pass' : 'fail'}`)
}

/**
 * Emit the native assertion rows at test-end: correlate the recorded calls with
 * `results.assertions`, then send each row with pass/fail (`result`) + the
 * verbose failure message (`error`, failures only) + a screenshot + its real
 * execution window. Rows are buffered (not streamed) at call time — Nightwatch
 * has no per-assertion result hook, so streaming them during the run would show
 * every assert as a neutral (green) row before its outcome is known. A call with
 * no matching result is skipped (defensive).
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
    | {
        assertions?: NwAssertionEntry[]
        commands?: NwCommandEntry[]
        testcases?: Record<string, { assertions?: unknown[] }>
      }
    | undefined
  const assertions = gatherResultAssertions(results)
  const outcomes = correlate(calls, assertions)
  const timings = assertCommandTimings(
    Array.isArray(results?.commands) ? results.commands : [],
    calls.length
  )
  // One shared screenshot for all rows — same DOM, ran consecutively.
  const screenshot = await resolveAssertionScreenshot(capturer, browser)

  calls.forEach((call, index) => {
    if (!call.entry) {
      return
    }
    const outcome = outcomes[index]
    if (outcome) {
      finalizeAssertionRow(
        capturer,
        call,
        outcome,
        timings[index],
        screenshot,
        testUid
      )
      return
    }
    // No execution outcome correlated to this call (defensive): emit the
    // buffered row in its neutral state so the assertion still appears — never
    // dropped, never mis-coloured as passed/failed. Rows are only buffered at
    // call time, so without this an uncorrelated assert would vanish.
    if (!call.entry.screenshot && screenshot) {
      call.entry.screenshot = screenshot
    }
    capturer.captureAssertCommand(call.entry)
  })
}
