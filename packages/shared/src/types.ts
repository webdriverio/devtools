// Canonical type definitions shared across @wdio/devtools-* packages.
//
// Adapters (service, nightwatch-devtools, selenium-devtools) produce events of
// these shapes. The backend stores and forwards them. The app consumes them.
// See ARCHITECTURE.md §2 and CLAUDE.md §2.1.

export const LOG_LEVELS = [
  'trace',
  'debug',
  'log',
  'info',
  'warn',
  'error'
] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

/** Where a captured ConsoleLog entry originated. */
export type LogSource = 'browser' | 'test' | 'terminal'

export enum TraceType {
  Standalone = 'standalone',
  Testrunner = 'testrunner'
}

export type TestStatus = 'passed' | 'failed' | 'skipped' | 'pending' | 'running'

/** `live` opens the DevTools UI window; `trace` skips it and lets a downstream exporter consume captured state. */
export type DevToolsMode = 'live' | 'trace'

/** `zip` (default) writes a single `trace-<id>.zip`; `ndjson-directory` writes
 *  the same `trace.trace` + `trace.network` + `resources/` layout unpacked
 *  into `trace-<id>/`. Both open in any standard trace viewer — the unpacked
 *  form skips the unzip step for agentic / scripted consumers. */
export type TraceFormat = 'zip' | 'ndjson-directory'

/** `session` (default) writes one trace per worker session; `spec` writes one
 *  trace per spec file, keyed on the spec's filename; `test` writes one trace
 *  per test. Only applies in trace mode. */
export type TraceGranularity = 'session' | 'spec' | 'test'

/** Retention policy for written traces. Only applies in trace mode; `on` is
 *  the current always-write behavior (there is no `off` — that's simply not
 *  using trace mode). */
export type TraceRetentionPolicy =
  | 'on'
  | 'retain-on-failure'
  | 'retain-on-first-failure'
  | 'on-first-retry'
  | 'on-all-retries'
  | 'retain-on-failure-and-retries'

/** Per-test screenshot capture policy, mirroring Playwright's `screenshot`
 *  option. `only-on-failure` shoots after a failing test; `on` after every
 *  test; `off` (default) never. Only applies in trace mode. */
export type TraceScreenshotPolicy = 'off' | 'on' | 'only-on-failure'

/** Per-test video capture policy. `off` (default) records nothing; any other
 *  value records the screencast and keeps each test's video slice per the same
 *  retention semantics as `tracePolicy`. Only applies in trace mode at
 *  `traceGranularity: 'test'` (the per-test scope videos attach to). */
export type TraceVideoPolicy = 'off' | TraceRetentionPolicy

/** One node in a test's ancestor chain, outermost first. */
export interface TestAncestor {
  uid: string
  title: string
  kind: 'feature' | 'scenario' | 'suite' | 'test' | 'step' | 'hook'
}

/** Per-test metadata for Tracing.tracingGroup events in trace output. */
export interface TestMetadataEntry {
  title: string
  specFile: string
  state?: TestStatus
  attempt?: number
  ancestry?: TestAncestor[]
}

/** Test metadata keyed by testUid — maps stable test IDs to human-readable
 *  title + specFile for Tracing.tracingGroup events in trace output. */
export type TestMetadataMap = Map<string, TestMetadataEntry>

/**
 * Normalized assertion result an adapter may attach to `CommandLog.result` for
 * an assertion command. The trace exporter's assert-param builder prefers this
 * over the positional `[actual, expected]` arg convention — correct for
 * frameworks whose asserts pass only an expected value (a matcher like
 * `titleContains('x')`), where args[0] is the expected, not the actual.
 * Cross-package contract: adapters produce it, core's exporter consumes it.
 */
export interface CollapsedAssertResult {
  passed: boolean
  actual?: unknown
  expected?: unknown
  message?: string
}

/**
 * Enum-style accessor for the canonical TestStatus values. Adapter code uses
 * this for readable comparisons (`state === TEST_STATE.PASSED`). The app's
 * sidebar has a parallel `TestState` accessor with the same values; that's a
 * naming holdover (PascalCase enum-style) — both can coexist.
 */
export const TEST_STATE = {
  PENDING: 'pending',
  RUNNING: 'running',
  PASSED: 'passed',
  FAILED: 'failed',
  SKIPPED: 'skipped'
} as const satisfies Record<string, TestStatus>

/**
 * Identifier sent by each adapter on RunnerRequestBody.framework. Used by the
 * backend's runner to pick rerun CLI args. This is technically the *test
 * runner* identifier rather than the higher-level framework (wdio/nightwatch/
 * selenium) — wdio's runner can be mocha/jasmine/cucumber, nightwatch can be
 * vanilla or cucumber, selenium adapters report 'selenium-webdriver'.
 */
export type TestRunnerId =
  | 'mocha'
  | 'jasmine'
  | 'cucumber'
  | 'nightwatch'
  | 'nightwatch-cucumber'
  | 'selenium-webdriver'

// ─── Inner event payloads ───────────────────────────────────────────────────

export interface PerformanceData {
  navigation?: {
    url: string
    timing: {
      loadTime?: number
      domReady?: number
      responseTime?: number
      dnsLookup?: number
      tcpConnection?: number
      serverResponse?: number
    }
  }
  resources?: Array<{
    url: string
    duration: number
    size: number
    type: string
    startTime: number
    responseEnd: number
  }>
}

export interface DocumentInfo {
  url: string
  title: string
  headers: { userAgent: string; language: string; platform: string }
  documentInfo: { readyState: string; referrer: string; characterSet: string }
}

export interface CommandLog {
  command: string
  args: unknown[]
  /** Optional display label (e.g. trace-player's `Element.fill("x")`). Falls
   *  back to `command` when absent. */
  title?: string
  result?: unknown
  error?: Error | SerializedError
  timestamp: number
  /** Wall-clock ms when the command was invoked (before execution). */
  startTime?: number
  callSource?: string
  screenshot?: string
  testUid?: string
  performance?: PerformanceData
  cookies?: string
  documentInfo?: DocumentInfo
  id?: number
}

/**
 * Payload broadcast under the WS scope `'replaceCommand'`. Tells the UI to
 * swap an existing CommandLog in-place — used when an adapter reconciles a
 * preliminary entry with the actual final result (e.g. selenium's
 * driverPatcher emits a placeholder, then replaces it once the command
 * resolves).
 */
export interface ReplaceCommandWsPayload {
  oldTimestamp: number
  command: CommandLog
}

export interface ConsoleLog {
  type: LogLevel
  args: unknown[]
  timestamp: number
  source?: LogSource
}

export interface NetworkRequest {
  id: string
  url: string
  method: string
  headers?: Record<string, string>
  cookies?: unknown[]
  status?: number
  statusText?: string
  timestamp: number
  startTime: number
  endTime?: number
  time?: number
  type: string
  initiator?: string
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  navigation?: string
  redirectChain?: unknown[]
  children?: NetworkRequest[]
  response?: {
    fromCache: boolean
    headers: Record<string, string>
    mimeType: string
    status: number
  }
  error?: string
  requestBody?: string
  responseBody?: string
  size?: number
}

// ─── Trace and metadata ─────────────────────────────────────────────────────

export interface Viewport {
  width: number
  height: number
  offsetLeft: number
  offsetTop: number
  scale: number
}

export interface ScreencastInfo {
  sessionId?: string
  videoPath?: string
  videoFile?: string
  frameCount?: number
  duration?: number
  startTime?: number
}

/** Single captured screencast frame — base64 image + capture timestamp (ms). */
export interface ScreencastFrame {
  /** Base64-encoded image data — JPEG/PNG from CDP push mode or PNG from browser.takeScreenshot() in polling mode. */
  data: string
  /** Unix timestamp in milliseconds. */
  timestamp: number
}

/**
 * Screencast recorder configuration. Used by every adapter — the base recorder
 * in `@wdio/devtools-core` consumes this shape; per-adapter wrappers extend it
 * (e.g. WDIO's CDP fast-path opts).
 */
export interface ScreencastOptions {
  /** Enable screencast recording for this session (default: false). */
  enabled?: boolean
  /**
   * Image format for individual frames (default: 'jpeg').
   * - Chrome/Chromium (CDP mode): controls the format Chrome sends over CDP.
   * - Other browsers (polling mode): screenshots are always PNG; ignored.
   * Does NOT affect the output video container, which is always WebM.
   */
  captureFormat?: 'jpeg' | 'png'
  /** JPEG quality 0–100 (default: 70). CDP mode + 'jpeg' only. */
  quality?: number
  /** Max frame width in pixels Chrome sends over CDP (default: 1280). */
  maxWidth?: number
  /** Max frame height in pixels Chrome sends over CDP (default: 720). */
  maxHeight?: number
  /**
   * Screenshot polling interval in milliseconds for non-Chrome browsers
   * (default: 200 ms ≈ 5 fps). Lower = smoother, more WebDriver round-trips.
   */
  pollIntervalMs?: number
}

/** Defaults applied to ScreencastOptions when not specified by the user. */
export const SCREENCAST_DEFAULTS: Required<ScreencastOptions> = {
  enabled: false,
  captureFormat: 'jpeg',
  quality: 70,
  maxWidth: 1280,
  maxHeight: 720,
  pollIntervalMs: 200
}

/**
 * Options every framework adapter accepts. Each adapter's own options interface
 * extends this and adds only its framework-specific fields (e.g. WDIO's
 * devtoolsCapabilities, Selenium's openUi, Nightwatch's bidi).
 */
export interface BaseDevToolsOptions {
  /** Port to launch the application on (default: random). */
  port?: number
  /** Hostname to launch the application on. @default localhost */
  hostname?: string
  /** Screencast recording options. When enabled, a continuous video of the
   *  browser session is recorded and saved as a .webm file. */
  screencast?: ScreencastOptions
  /** Capture node:assert assertions (and framework `expect` matchers where
   *  supported) as first-class commands. Default true. */
  captureAssertions?: boolean
  /** `live` (default) launches the DevTools UI; `trace` skips it. */
  mode?: DevToolsMode
  /** Trace output layout — `zip` (default) writes a single archive,
   *  `ndjson-directory` unpacks into `trace-<id>/`. Only applies in trace mode. */
  traceFormat?: TraceFormat
  /** Trace output granularity — `session` (default) writes one trace per
   *  worker session; `spec` writes one per spec file. Only applies in trace mode. */
  traceGranularity?: TraceGranularity
  /** Trace retention policy — gates which traces are kept (e.g.
   *  `retain-on-failure`). Default `on` (keep all). Only applies in trace mode. */
  tracePolicy?: TraceRetentionPolicy
  /** Per-test screenshot capture, attached to the trace artifacts and to Allure
   *  inline. `off` (default) | `on` | `only-on-failure`. Only applies in trace
   *  mode. */
  screenshot?: TraceScreenshotPolicy
  /** Per-test video (screencast) capture, retained per the given policy and
   *  attached to Allure inline. `off` (default) or a retention policy. Only
   *  applies in trace mode at `traceGranularity: 'test'`. */
  video?: TraceVideoPolicy
}

/** Minimal Cucumber pickle-step shape — only the fields the adapters read.
 *  Cucumber's own types vary across versions, so we pin just these. */
export interface CucumberPickleStep {
  text?: string
  astNodeIds?: string[]
  location?: { line?: number }
}

/** Minimal Cucumber pickle shape — only the fields the adapters read. `steps`
 *  is present only where the adapter walks step boundaries (Nightwatch). */
export interface CucumberPickle {
  name?: string
  uri?: string
  location?: { line?: number }
  astNodeIds?: string[]
  steps?: CucumberPickleStep[]
}

export interface Metadata {
  type: TraceType
  url?: string
  options?: unknown
  capabilities?: unknown
  viewport?: Viewport
  sessionId?: string
  testEnv?: string
  host?: string
  modulePath?: string
  desiredCapabilities?: Record<string, unknown>
}

/** Captured metadata keyed by browser `sessionId` — lets the UI keep each
 *  session's metadata instead of overwriting on a new session. Record (not Map)
 *  so it stays JSON-serializable across the WS boundary and in contexts. */
export type MetadataBySession = Record<string, Metadata>

/**
 * Node-safe shape of a captured DOM mutation. The browser-side script
 * (packages/script) extends this with the real `MutationRecordType` union
 * via the global `TraceMutation` declaration there; this Node version uses
 * a plain string literal type so the shape can flow through shared without
 * dragging the DOM lib into shared's compilation.
 *
 * `addedNodes` / `removedNodes` are opaque payloads here — the browser side
 * stringifies / serializes them via SimplifiedVNode.
 */
export interface TraceMutation {
  type: 'attributes' | 'characterData' | 'childList'
  attributeName?: string
  attributeNamespace?: string
  attributeValue?: string
  newTextContent?: string
  oldValue?: string
  addedNodes: unknown[]
  target?: string
  removedNodes: string[]
  previousSibling?: string
  nextSibling?: string
  timestamp: number
  url?: string
}

/**
 * Captured at each user-facing action boundary in `trace` mode. Feeds the
 * downstream trace.zip exporter (Phase 4). `screenshot` is base64-encoded JPEG.
 */
export interface ActionSnapshot {
  timestamp: number
  command: string
  url?: string
  title?: string
  screenshot?: string
  elements?: unknown[]
  snapshotText?: string
}

export interface TraceLog {
  mutations: TraceMutation[]
  logs: string[]
  consoleLogs: ConsoleLog[]
  networkRequests: NetworkRequest[]
  metadata: Metadata
  commands: CommandLog[]
  sources: Record<string, string>
  suites?: Record<string, unknown>[]
  screencast?: ScreencastInfo
  config?: { configFile?: string }
  /** Per-action snapshots captured in `mode: 'trace'` for the trace.zip exporter. */
  actionSnapshots?: ActionSnapshot[]
}

// ─── Preserve-and-rerun ─────────────────────────────────────────────────────

export interface TestError {
  message?: string
  name?: string
  stack?: string
  /** expect-webdriverio surfaces these directly on the error. */
  expected?: unknown
  actual?: unknown
  /** expect-webdriverio also bundles them under matcherResult. */
  matcherResult?: {
    expected?: unknown
    actual?: unknown
    message?: string
  }
}

export interface PreservedStep {
  uid: string
  title?: string
  fullTitle?: string
  start?: number
  end?: number
  state?: TestStatus
  error?: TestError
}

export interface PreservedAttempt {
  testUid: string
  scope: 'test' | 'suite'
  capturedAt: number
  window: { start: number; end: number }
  test: {
    title?: string
    fullTitle?: string
    file?: string
    callSource?: string
    start?: number
    end?: number
    duration?: number
    state?: TestStatus
    error?: TestError
  }
  steps?: PreservedStep[]
  commands: CommandLog[]
  consoleLogs: ConsoleLog[]
  networkRequests: NetworkRequest[]
  /** See note on TraceLog.mutations. */
  mutations: unknown[]
  sources: Record<string, string>
}

// ─── Test reporter stats (nightwatch + selenium adapters) ───────────────────

/**
 * Serialized form of an `Error` — a plain object that survives
 * `JSON.stringify` over the WS bridge.
 */
export interface SerializedError {
  name: string
  message: string
  stack?: string
}

/**
 * An error payload as it flows through capture: the raw `Error` instance at
 * capture time, or its serialized form once it has crossed the WS bridge.
 */
export type ReporterError = Error | SerializedError

export interface TestStats {
  uid: string
  cid: string
  title: string
  fullTitle: string
  parent: string
  state: TestStatus
  start: Date
  end: Date | null
  type: 'test'
  file: string
  retries: number
  _duration: number
  error?: ReporterError
  hooks?: unknown[]
  callSource?: string
}

export interface SuiteStats {
  uid: string
  cid: string
  title: string
  fullTitle: string
  type: 'suite'
  file: string
  start: Date
  state?: TestStatus
  end?: Date | null
  tests: (string | TestStats)[]
  suites: SuiteStats[]
  hooks: unknown[]
  _duration: number
  parent?: string
  callSource?: string
  /** Cucumber-only: the .feature file path. Distinct from `file` because the
   *  root suite's `file` stays at cwd to keep its stable UID; rerun payloads
   *  use this to drive feature-level filtering. */
  featureFile?: string
}
