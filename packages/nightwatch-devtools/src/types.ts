// Nightwatch-specific types live here. Cross-package types come from @wdio/devtools-shared.

export {
  TraceType,
  type ActionSnapshot,
  type CollapsedAssertResult,
  type CommandLog,
  type ConsoleLog,
  type DevToolsMode,
  type DocumentInfo,
  type LogLevel,
  type Metadata,
  type NetworkRequest,
  type PerformanceData,
  type ScreencastFrame,
  type ScreencastOptions,
  type SuiteStats,
  type TestRunnerId,
  type TestStats,
  type TestStatus,
  type TraceFormat,
  type TestMetadataMap,
  type TraceGranularity,
  type TraceRetentionPolicy,
  type TraceScreenshotPolicy,
  type TraceVideoPolicy,
  type TraceLog
} from '@wdio/devtools-shared'

import type {
  BaseDevToolsOptions,
  CommandLog,
  TraceScreenshotPolicy,
  TraceVideoPolicy
} from '@wdio/devtools-shared'

export interface CommandStackFrame {
  command: string
  callSource?: string
  signature: string
}

/** Nightwatch's chainable command result — exposes `.perform` to queue work
 *  after the command completes. Cucumber async/await mode returns a Promise
 *  instead, so callers narrow on `.perform` before using it. */
export interface NightwatchChainable {
  perform?: (cb: (done: Function) => void) => void
}

/** One intercepted command call, split into the parts capture needs. */
export interface CommandInvocation {
  /** Nightwatch passes results to a trailing callback; a user-supplied one must
   *  still run after capture. */
  userCallback: ((result: unknown) => unknown) | null
  logArgs: unknown[]
  /** Identifies a retry of the same call from the same source line. */
  cmdSig: string
  callSource: string | undefined
  /** False for commands Nightwatch issues from inside its own queue, which have
   *  no user frame on the stack and must not surface as top-level actions. */
  hasUserSource: boolean
}

/** Everything a captured row carries beyond the call itself. Named rather than
 *  positional so a field the command doesn't name — the target selector, which
 *  a node:assert row can only learn from value provenance — reaches the row
 *  through the capture call instead of being stamped on afterwards. */
export interface CommandCaptureMeta {
  testUid?: string
  callSource?: string
  /** Wall-clock at completion; defaults to capture time. */
  timestamp?: number
  /** Wall-clock at invocation, so the row spans its real duration. */
  startTime?: number
  /** Issue order — what the exporter sorts on when timestamps tie. */
  sequence?: number
  /** Element the row is about, when one is known. */
  selector?: string
}

/** How a native assertion's own returned promise settled. */
export interface AssertSettlement {
  rejected: boolean
  /** The fulfilment value, or the rejection reason when `rejected`. */
  value: unknown
  settledAt: number
}

/** Pass/fail read off a native assertion's own returned promise — the only
 *  outcome source for the cucumber runner, whose results bag stays empty. */
export interface ObservedAssertOutcome {
  passed: boolean
  message: string
  /** Wall-clock at settlement — the assertion's real execution end. */
  settledAt: number
}

/** One explicit `browser.assert.*` / `browser.verify.*` call, recorded at call
 *  time by NativeAssertRecorder. Its row (`entry`) is buffered, not streamed —
 *  `captureNativeAssertions` emits it at test-end once its outcome is known. */
export interface NativeAssertCall {
  prefix: 'assert' | 'verify'
  method: string
  args: unknown[]
  callSource?: string
  /** Wall-clock at call time; also the streamed row's timestamp/startTime. */
  timestamp: number
  /** The pending row emitted at call time, updated in place when finalized. */
  entry?: CommandLog
  /** Filled in asynchronously when the call's own promise settles; absent when
   *  the settlement carried no outcome evidence (see observedAssertOutcome). */
  observed?: ObservedAssertOutcome
}

export interface NightwatchTestCase {
  passed: number
  failed: number
  errors: number
  skipped: number
  time: string
  assertions: unknown[]
}

/** Nightwatch's per-test results bag. Loose by design — fields vary across
 *  Nightwatch versions. We read only the pieces we need; everything else
 *  flows through as `unknown`. */
export interface NightwatchTestResults {
  errors?: number
  failed?: number
  passed?: number
  skipped?: number
  testcases?: Record<string, NightwatchTestCase>
  [key: string]: unknown
}

/** `browser.currentTest` shape — Nightwatch documents this informally. */
export interface NightwatchCurrentTest {
  name?: string
  module?: string
  group?: string
  results?: NightwatchTestResults
  [key: string]: unknown
}

/** Nightwatch `eventHub` shape — only `runner` + `on()` are documented; the
 *  rest of the public surface is `unknown` to us. */
export interface NightwatchEventHub {
  runner?: string
  on(event: string, listener: (data: unknown) => void): void
  [key: string]: unknown
}

export interface TestFileMetadata {
  suiteTitle: string | null
  suiteLine: number | null
  testNames: string[]
  testLines: number[]
}

export interface StepLocation {
  filePath: string
  line: number
}

export interface DevToolsOptions extends BaseDevToolsOptions {
  /**
   * Enable WebDriver BiDi capture (browser console + JS exceptions + network
   * via `selenium-webdriver/bidi`). Requires `webSocketUrl: true` in your
   * capabilities and a BiDi-capable chromedriver. When attached, the per-
   * command perf-log network capture path is gated off to avoid duplicate
   * entries. Defaults to `false` — opt-in.
   */
  bidi?: boolean
  /** Per-test screenshot capture, produced to the trace output dir + manifest.
   *  `off` (default) | `on` | `only-on-failure`. Trace mode +
   *  `traceGranularity: 'test'` only. Produce-only: Nightwatch has no live
   *  Allure attach API, so artifacts are not attached inline. */
  screenshot?: TraceScreenshotPolicy
  /** Per-test video (screencast slice) capture, produced to the trace output
   *  dir + manifest per the given retention policy. `off` (default) or a
   *  retention policy. Trace mode + `traceGranularity: 'test'` only.
   *  Produce-only (no inline Allure attach). */
  video?: TraceVideoPolicy
}

export interface NightwatchBrowser {
  url: (url: string) => Promise<unknown>
  execute: (
    script: string | ((...args: unknown[]) => unknown),
    args?: unknown[]
  ) => Promise<unknown>
  executeAsync: (
    script: (...args: unknown[]) => unknown,
    args?: unknown[]
  ) => Promise<unknown>
  pause: (ms: number) => Promise<unknown>
  capabilities?: Record<string, unknown>
  desiredCapabilities?: Record<string, unknown>
  sessionId?: string
  /** Driver instance from selenium-webdriver — its public shape is wide; we
   *  pass it through to BiDi attach helpers that do their own narrowing. */
  driver?: unknown
  options?: {
    testEnv?: string
    webdriver?: { host?: string }
    [key: string]: unknown
  }
  currentTest?: NightwatchCurrentTest
  results?: unknown
  queue?: unknown
}
