// Selenium-specific types live here. Cross-package types come from @wdio/devtools-shared.

export {
  TraceType,
  type ActionSnapshot,
  type CommandLog,
  type ConsoleLog,
  type DevToolsMode,
  type DocumentInfo,
  type LogLevel,
  type Metadata,
  type NetworkRequest,
  type PerformanceData,
  type SuiteStats,
  type TestStats,
  type TestStatus,
  type TraceFormat
} from '@wdio/devtools-shared'

export interface DevToolsOptions {
  port?: number
  hostname?: string
  /** Open a Chrome window pointing at the UI. Default true. */
  openUi?: boolean
  /** `live` (default) launches the DevTools UI; `trace` skips it. Overrides `openUi`. */
  mode?: DevToolsMode
  /** Trace output layout — `zip` (default) writes a single archive,
   *  `ndjson-directory` unpacks into `trace-<id>/`. Only applies in trace mode. */
  traceFormat?: TraceFormat
  /** Capture screenshots after each command. Default true. */
  captureScreenshots?: boolean
  /** Command template for per-test rerun. {{testName}} is substituted. */
  rerunCommand?: string
  /** Per-session screencast recording. Disabled by default. */
  screencast?: ScreencastOptions
  /**
   * Force the *test* browser into headless mode by injecting --headless=new
   * into Chrome capabilities. The dashboard window (auto-opened by openUi)
   * is unaffected. Defaults to false to preserve user-supplied options.
   */
  headless?: boolean
}

// ScreencastFrame, ScreencastOptions hoisted to @wdio/devtools-shared; re-exported
// here for backwards compatibility with existing selenium-internal imports.
import type {
  DevToolsMode,
  ScreencastOptions,
  TraceFormat
} from '@wdio/devtools-shared'
export type { ScreencastFrame, ScreencastOptions } from '@wdio/devtools-shared'

/**
 * Minimal shape of a selenium-webdriver `WebDriver` instance that the plugin
 * relies on. We don't import the type from selenium-webdriver to avoid a hard
 * dependency on the user's installed version — Selenium types vary across
 * minor versions and we only touch a small surface.
 */
export interface SeleniumDriverLike {
  executeScript: (
    script: string | Function,
    ...args: unknown[]
  ) => Promise<unknown>
  takeScreenshot?: () => Promise<string>
  getSession?: () => Promise<{ getId: () => string }>
  getCapabilities?: () => Promise<unknown>
  manage?: () => unknown
  quit?: () => Promise<void>
  close?: () => Promise<void>
  /** Selenium 4 helper used by the screencast recorder. */
  createCDPConnection?: (target: string) => Promise<unknown>
  [key: string]: unknown
}

// ─── driverPatcher ──────────────────────────────────────────────────────────

export interface CapturedCommand {
  command: string
  args: unknown[]
  // Sanitized result safe to JSON.stringify over the wire.
  result: unknown
  // Raw selenium result kept by reference for in-process enrichment — must
  // NOT be sent upstream (contains non-serialisable WebElement state).
  rawResult?: unknown
  error: Error | undefined
  callSource: string | undefined
  timestamp: number
  fromElement: boolean
}

export interface DriverPatcherHooks {
  onBeforeBuild?: (builder: unknown) => void
  onDriverCreated: (driver: SeleniumDriverLike) => void | Promise<void>
  onCommand: (cmd: CapturedCommand) => void
  // Awaited before delegating to the original `driver.quit()` so async
  // cleanup (video encode, WS flush) can run before runners that
  // `process.exit()` after their last hook bypass node's beforeExit.
  onBeforeQuit?: (driver: SeleniumDriverLike) => Promise<void>
  // Gates `await new Builder().build()` on the dashboard being connected.
  waitForReady?: () => Promise<void>
}

// Unwrapped WebDriver methods used by the plugin's own internal calls
// (screenshot, script injection, trace fetch) so they don't recurse through
// the wrapper or appear in the UI command list.
export interface DriverOriginals {
  takeScreenshot?: (driver: SeleniumDriverLike) => Promise<string>
  executeScript?: (
    driver: SeleniumDriverLike,
    script: string,
    ...args: unknown[]
  ) => Promise<unknown>
  manage?: (driver: SeleniumDriverLike) => unknown
}

// Unwrapped WebElement methods for internal enrichment paths.
export interface ElementOriginals {
  getText?: (element: unknown) => Promise<string>
  getTagName?: (element: unknown) => Promise<string>
}

// ─── bidi ───────────────────────────────────────────────────────────────────

import type { ConsoleLog, NetworkRequest } from '@wdio/devtools-shared'

export interface BidiHandlerSinks {
  pushConsoleLog: (entry: ConsoleLog) => void
  pushNetworkRequest: (entry: NetworkRequest) => void
  replaceNetworkRequest: (id: string, entry: NetworkRequest) => void
}

// ─── runnerHooks ────────────────────────────────────────────────────────────

export interface MochaTestCtx {
  title?: string
  file?: string
  state?: 'passed' | 'failed' | 'pending' | 'running' | 'skipped'
  duration?: number
  parent?: { title?: string }
}

export interface RunnerHookCallbacks {
  onTestStart: (
    name: string,
    file?: string,
    callSource?: string,
    suiteName?: string,
    suiteCallSource?: string
  ) => void
  onTestEnd: (state: 'passed' | 'failed' | 'skipped' | 'pending') => void
  // Cucumber-only: scenario boundary creates a sub-suite under the feature
  // rootSuite; subsequent onTestStart/onTestEnd attach as Gherkin steps inside.
  onScenarioStart?: (
    name: string,
    file?: string,
    callSource?: string,
    featureName?: string,
    featureCallSource?: string
  ) => void
  onScenarioEnd?: (state: 'passed' | 'failed' | 'skipped' | 'pending') => void
  // Fires from the runner's after-all hook so the dashboard suite header
  // updates without waiting for process exit.
  onTestRunComplete?: (summary: {
    passed: number
    failed: number
    pending: number
    durationMs: number
  }) => void
}
