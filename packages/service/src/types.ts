// WDIO-specific types live here. Cross-package types come from @wdio/devtools-shared.
//
// Re-exports below maintain backwards compatibility for external consumers of
// @wdio/devtools-service/types. New code should import directly from
// @wdio/devtools-shared.

export {
  TraceType,
  type CommandLog,
  type ConsoleLog,
  type DocumentInfo,
  type LogLevel,
  type Metadata,
  type NetworkRequest,
  type PerformanceData,
  type PreservedAttempt,
  type PreservedStep,
  type ScreencastInfo,
  type TestStatus,
  type TraceLog,
  type Viewport
} from '@wdio/devtools-shared'

export interface ScreencastFrame {
  /** Base64-encoded image data — JPEG/PNG from CDP push mode or PNG from browser.takeScreenshot() in polling mode */
  data: string
  /** Unix timestamp in milliseconds */
  timestamp: number
}

export interface ScreencastOptions {
  /** Enable screencast recording for this session (default: false) */
  enabled?: boolean
  /**
   * Image format for individual frames (default: 'jpeg').
   * - Chrome/Chromium (CDP mode): controls the format Chrome sends over CDP.
   * - Other browsers (polling mode): screenshots are always PNG; this option
   *   is ignored.
   * Does NOT affect the output video container, which is always WebM.
   */
  captureFormat?: 'jpeg' | 'png'
  /**
   * JPEG quality 0–100 (default: 70).
   * Only applies in Chrome/Chromium CDP mode with captureFormat 'jpeg'.
   */
  quality?: number
  /**
   * Max frame width in pixels Chrome sends over CDP (default: 1280).
   * Only applies in Chrome/Chromium CDP mode.
   */
  maxWidth?: number
  /**
   * Max frame height in pixels Chrome sends over CDP (default: 720).
   * Only applies in Chrome/Chromium CDP mode.
   */
  maxHeight?: number
  /**
   * Screenshot polling interval in milliseconds for non-Chrome browsers
   * (default: 200 ms ≈ 5 fps).
   * Polling calls browser.takeScreenshot() at this interval. A lower value
   * gives smoother video but adds more WebDriver round-trips during the test.
   */
  pollIntervalMs?: number
}

export interface ExtendedCapabilities extends WebdriverIO.Capabilities {
  'wdio:devtoolsOptions'?: ServiceOptions
}

export interface ServiceOptions {
  /**
   * port to launch the application on (default: random)
   */
  port?: number
  /**
   * hostname to launch the application on
   * @default localhost
   */
  hostname?: string
  /**
   * capabilities used to launch the devtools application
   * @default
   * ```ts
   * {
   *   browserName: 'chrome',
   *   'goog:chromeOptions': {
   *     args: ['--window-size=1200,800']
   *   }
   * }
   */
  devtoolsCapabilities?: WebdriverIO.Capabilities
  /**
   * Screencast recording options. When enabled, a continuous video of the
   * browser session is recorded and saved as a .webm file. Chrome/Chromium
   * uses CDP push mode; all other browsers fall back to screenshot polling.
   */
  screencast?: ScreencastOptions
}

declare namespace WebdriverIO {
  interface ServiceOption extends ServiceOptions {}
  interface Capabilities {}
}

declare module '@wdio/reporter' {
  interface TestStats {
    file?: string
    line?: number
    column?: number
    callSource?: string
    featureFile?: string
    featureLine?: number
    // Cucumber pickle augmentations (the WDIO Cucumber adapter attaches these
    // on scenarios; @wdio/reporter's base types don't include them). `argument`
    // already exists in the base with a different shape, so reads of its
    // Cucumber-specific fields stay locally cast in reporter.ts.
    pickle?: { uri?: string; location?: { line?: number } }
    uri?: string
  }

  interface SuiteStats {
    line?: string | number | null
    callSource?: string
    featureFile?: string
    featureLine?: number
    pickle?: { uri?: string; location?: { line?: number } }
    uri?: string
  }
}

export type StepDef = {
  kind: 'regex' | 'string' | 'expression'
  keyword?: string
  text?: string
  regex?: RegExp
  expr?: any
  file: string
  line: number
  column: number
}
