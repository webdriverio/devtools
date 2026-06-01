// Selenium-specific types live here. Cross-package types come from @wdio/devtools-shared.

export {
  TraceType,
  type CommandLog,
  type ConsoleLog,
  type DocumentInfo,
  type LogLevel,
  type Metadata,
  type NetworkRequest,
  type PerformanceData,
  type SuiteStats,
  type TestStats,
  type TestStatus
} from '@wdio/devtools-shared'

export interface DevToolsOptions {
  port?: number
  hostname?: string
  /** Open a Chrome window pointing at the UI. Default true. */
  openUi?: boolean
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

export interface ScreencastFrame {
  /** Base64-encoded image data — JPEG/PNG. */
  data: string
  /** Unix timestamp in milliseconds. */
  timestamp: number
}

export interface ScreencastOptions {
  /** Enable screencast recording for this session (default: false). */
  enabled?: boolean
  /** Image format for individual frames (default: 'jpeg'). Chromium-only. */
  captureFormat?: 'jpeg' | 'png'
  /** JPEG quality 0–100 (default: 70). Chromium-only. */
  quality?: number
  /** Max frame width in px Chrome sends over CDP (default: 1280). Chromium-only. */
  maxWidth?: number
  /** Max frame height in px Chrome sends over CDP (default: 720). Chromium-only. */
  maxHeight?: number
  /**
   * Polling interval for non-Chromium fallback (default: 200 ms).
   * Used when CDP isn't available — calls driver.takeScreenshot() at this rate.
   */
  pollIntervalMs?: number
}

/**
 * Minimal shape of a selenium-webdriver `WebDriver` instance that the plugin
 * relies on. We don't import the type from selenium-webdriver to avoid a hard
 * dependency on the user's installed version — Selenium types vary across
 * minor versions and we only touch a small surface.
 */
export interface SeleniumDriverLike {
  executeScript: (script: string | Function, ...args: any[]) => Promise<any>
  takeScreenshot?: () => Promise<string>
  getSession?: () => Promise<{ getId: () => string }>
  getCapabilities?: () => Promise<any>
  manage?: () => any
  quit?: () => Promise<void>
  close?: () => Promise<void>
  [key: string]: any
}

// ─── driverPatcher ──────────────────────────────────────────────────────────

export interface CapturedCommand {
  command: string
  args: any[]
  // Sanitized result safe to JSON.stringify over the wire.
  result: any
  // Raw selenium result kept by reference for in-process enrichment — must
  // NOT be sent upstream (contains non-serialisable WebElement state).
  rawResult?: any
  error: Error | undefined
  callSource: string | undefined
  timestamp: number
  fromElement: boolean
}

export interface DriverPatcherHooks {
  onBeforeBuild?: (builder: any) => void
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
    ...args: any[]
  ) => Promise<any>
  manage?: (driver: SeleniumDriverLike) => any
}

// Unwrapped WebElement methods for internal enrichment paths.
export interface ElementOriginals {
  getText?: (element: any) => Promise<string>
  getTagName?: (element: any) => Promise<string>
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
