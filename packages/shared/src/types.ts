// Canonical type definitions shared across @wdio/devtools-* packages.
//
// Adapters (service, nightwatch-devtools, selenium-devtools) produce events of
// these shapes. The backend stores and forwards them. The app consumes them.
// See ARCHITECTURE.md §2 and CLAUDE.md §2.1.

export type LogLevel = 'trace' | 'debug' | 'log' | 'info' | 'warn' | 'error'

export enum TraceType {
  Standalone = 'standalone',
  Testrunner = 'testrunner'
}

export type TestStatus = 'passed' | 'failed' | 'skipped' | 'pending' | 'running'

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
  args: any[]
  result?: any
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

export interface ConsoleLog {
  type: LogLevel
  args: any[]
  timestamp: number
  source?: string
}

export interface NetworkRequest {
  id: string
  url: string
  method: string
  headers?: Record<string, string>
  cookies?: any[]
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
  redirectChain?: any[]
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

export interface TraceLog {
  // Mutations are typed as unknown[] here because the concrete shape lives in
  // packages/script (browser-side, depends on DOM types). Adapters and the app
  // can narrow with their own DOM-aware TraceMutation type when needed.
  mutations: unknown[]
  logs: string[]
  consoleLogs: ConsoleLog[]
  networkRequests: NetworkRequest[]
  metadata: Metadata
  commands: CommandLog[]
  sources: Record<string, string>
  suites?: Record<string, unknown>[]
  screencast?: ScreencastInfo
  config?: { configFile?: string }
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
