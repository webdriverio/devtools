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
  assertions: any[]
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
  url: (url: string) => Promise<any>
  execute: (script: string | Function, args?: any[]) => Promise<any>
  executeAsync: (script: Function, args?: any[]) => Promise<any>
  pause: (ms: number) => Promise<any>
  capabilities?: Record<string, any>
  desiredCapabilities?: Record<string, any>
  sessionId?: string
  driver?: any
  options?: {
    testEnv?: string
    webdriver?: { host?: string }
    [key: string]: any
  }
  currentTest?: {
    name?: string
    module?: string
    group?: string
    [key: string]: any
  }
  results?: any
  queue?: any
}
