// Nightwatch-specific types live here. Cross-package types come from @wdio/devtools-shared.

export {
  TraceType,
  type CommandLog,
  type ConsoleLog,
  type DocumentInfo,
  type LogLevel,
  type Metadata,
  type NetworkRequest,
  type PerformanceData,
  type ScreencastFrame,
  type ScreencastOptions,
  type SuiteStats,
  type TestStats,
  type TestStatus,
  type TraceLog
} from '@wdio/devtools-shared'

import type { ScreencastOptions } from '@wdio/devtools-shared'

export interface CommandStackFrame {
  command: string
  callSource?: string
  signature: string
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

export interface DevToolsOptions {
  port?: number
  hostname?: string
  /**
   * Screencast recording options. When enabled, a continuous video of the
   * browser session is recorded and saved as a .webm file at the end of the
   * test run. Polling mode only on Nightwatch (no CDP push); works on every
   * browser Nightwatch supports.
   */
  screencast?: ScreencastOptions
  /**
   * Enable WebDriver BiDi capture (browser console + JS exceptions + network
   * via `selenium-webdriver/bidi`). Requires `webSocketUrl: true` in your
   * capabilities and a BiDi-capable chromedriver. When attached, the per-
   * command perf-log network capture path is gated off to avoid duplicate
   * entries. Defaults to `false` — opt-in.
   */
  bidi?: boolean
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
  currentTest?: {
    name?: string
    module?: string
    group?: string
    [key: string]: unknown
  }
  results?: unknown
  queue?: unknown
}
