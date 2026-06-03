/**
 * Single internals "bag" the plugin exposes to its lifecycle modules.
 *
 * Each lifecycle module declares its own narrow `Ctx` interface; the plugin
 * builds ONE `PluginInternals` object that structurally satisfies all of
 * them. This keeps the plugin file compact (one accessor block instead of
 * four) while still letting each lifecycle module narrow its dependencies.
 */

import type { SessionCapturer } from './session.js'
import type { TestReporter } from './reporter.js'
import type { ScreencastRecorder } from './screencast.js'
import type { TestManager } from './helpers/testManager.js'
import type { SuiteManager } from './helpers/suiteManager.js'
import type { BrowserProxy } from './helpers/browserProxy.js'
import type {
  NightwatchBrowser,
  ScreencastOptions,
  SuiteStats,
  TestStats
} from './types.js'

export interface PluginInternals {
  // Config + options
  options: { hostname: string; port: number }
  readonly hostname: string
  readonly port: number
  readonly screencastOptions: ScreencastOptions
  readonly bidiEnabled: boolean

  // Runtime instances (mutable — bringup/session-change replaces them)
  sessionCapturer: SessionCapturer
  testReporter: TestReporter
  testManager: TestManager
  suiteManager: SuiteManager
  browserProxy: BrowserProxy
  isScriptInjected: boolean
  devtoolsBrowser: WebdriverIO.Browser | undefined
  userDataDir: string | undefined

  // Run state
  passCount: number
  failCount: number
  skipCount: number

  // Session state
  lastSessionId: string | null
  bidiAttachAttempted: boolean
  srcFolders: string[]
  screencastRecorder: ScreencastRecorder | undefined
  screencastSessionId: string | undefined

  /** Absolute path to the resolved Nightwatch config file, if known. Used as
   *  a fallback directory for screencast video output. */
  configPath: string | undefined

  // Current execution (set by lifecycle, read across modules)
  getCurrentTest(): unknown
  getCurrentScenarioSuite(): SuiteStats | null
  getCurrentStep(): unknown
  setCurrentTest(t: unknown): void
  setCurrentScenarioSuite(s: SuiteStats | null): void
  setCurrentStep(s: unknown): void

  // Plugin-side delegates
  clearExecutionData(): void
  buildMetadataOptions(): unknown
  ensureSessionInitialized(b: NightwatchBrowser): Promise<void>
  wrapBrowserOnce(b: NightwatchBrowser): void
  incrementCount(state: TestStats['state']): void
  testIcon(state: TestStats['state']): string
  setCucumberRunner(v: boolean): void
  getRerunLabel(): string | undefined
}
