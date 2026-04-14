import type { WebDriverCommands } from '@wdio/protocols'
import type { Capabilities, Options } from '@wdio/types'
import type { SuiteStats } from '@wdio/reporter'

export interface CommandLog {
  command: keyof WebDriverCommands
  args: any[]
  result: any
  error?: Error
  timestamp: number
  callSource: string
  screenshot?: string
  testUid?: string
}

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

export interface ScreencastInfo {
  sessionId?: string
  /** Absolute path to the encoded video file on disk */
  videoPath?: string
  /** Filename only, e.g. wdio-video-{sessionId}.webm */
  videoFile?: string
  frameCount?: number
  /** Duration in milliseconds between first and last frame */
  duration?: number
}

export enum TraceType {
  Standalone = 'standalone',
  Testrunner = 'testrunner'
}

export interface Viewport {
  width: number
  height: number
  offsetLeft: number
  offsetTop: number
  scale: number
}

export interface Metadata {
  type: TraceType
  url: string
  options: Omit<Options.WebdriverIO, 'capabilities'>
  capabilities: Capabilities.W3CCapabilities
  viewport: Viewport
  /** Nightwatch / extended fields */
  sessionId?: string
  testEnv?: string
  host?: string
  modulePath?: string
  desiredCapabilities?: Record<string, unknown>
}

export interface TraceLog {
  mutations: TraceMutation[]
  logs: string[]
  consoleLogs: ConsoleLogs[]
  networkRequests: NetworkRequest[]
  metadata: Metadata
  commands: CommandLog[]
  sources: Record<string, string>
  suites?: Record<string, SuiteStats>[]
  screencast?: ScreencastInfo
}

export interface ExtendedCapabilities extends WebdriverIO.Capabilities {
  'wdio:devtoolsOptions'?: ServiceOptions
}

export type LogLevel = 'trace' | 'debug' | 'log' | 'info' | 'warn' | 'error'

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
  }

  interface SuiteStats {
    line?: string | number | null
    callSource?: string
    featureFile?: string
    featureLine?: number
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
