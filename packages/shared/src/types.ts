// Canonical type definitions shared across @wdio/devtools-* packages.
//
// Adapters (service, nightwatch-devtools, selenium-devtools) produce events of
// these shapes. The backend stores and forwards them. The app consumes them.
// See ARCHITECTURE.md §2 and CLAUDE.md §2.1.

export type LogLevel = 'trace' | 'debug' | 'log' | 'info' | 'warn' | 'error'

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
 *  into `trace-<id>/`. Both are consumable by `playwright show-trace` — the
 *  unpacked form skips the unzip step for agentic / scripted consumers. */
export type TraceFormat = 'zip' | 'ndjson-directory'

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
  result?: unknown
  error?: Error | { name: string; message: string; stack?: string }
  timestamp: number
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
 * Serialized form of an `Error`, used after capture so the payload survives
 * `JSON.stringify` over the WS bridge. The capture-time shape (raw `Error`
 * instance) is also accepted for callers that haven't serialized yet.
 */
export type ReporterError =
  | Error
  | { name: string; message: string; stack?: string }

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
