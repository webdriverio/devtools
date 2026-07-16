/**
 * Single internals "bag" the plugin exposes to its lifecycle modules.
 *
 * Each lifecycle module declares its own narrow `Ctx` interface; the plugin
 * builds ONE `PluginInternals` object that structurally satisfies all of
 * them. This keeps the plugin file compact (one accessor block instead of
 * four) while still letting each lifecycle module narrow its dependencies.
 */

import type { SpecRange, TraceArtifact } from '@wdio/devtools-core'
import type { SessionCapturer } from './session.js'
import type { TestReporter } from './reporter.js'
import type { ScreencastRecorder } from './screencast.js'
import type { TestManager } from './helpers/testManager.js'
import type { SuiteManager } from './helpers/suiteManager.js'
import type { BrowserProxy } from './helpers/browserProxy.js'
import type {
  DevToolsMode,
  NightwatchBrowser,
  ScreencastOptions,
  SuiteStats,
  TestStats,
  TraceGranularity
} from './types.js'

export interface PluginInternals {
  // Config + options
  options: { hostname: string; port: number; mode?: DevToolsMode }
  readonly hostname: string
  readonly port: number
  readonly mode: DevToolsMode
  readonly screencastOptions: ScreencastOptions
  readonly bidiEnabled: boolean
  readonly captureAssertions: boolean

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

  /** Records a test/scenario start under its retry-stable uid; `specFile`
   *  (when known) enables spec-scoped retention. Returns the 0-based attempt
   *  number (0 first run, +1 per rerun). */
  recordAttempt(uid: string, specFile?: string): number
  /** Stamps the resolved terminal state onto uid's latest attempt slot so the
   *  retry-aware retention policies see real per-attempt outcomes. */
  recordOutcome(uid: string, state: TestStats['state']): void
  /** Latest attempt recorded for `uid`, or undefined if it never started. */
  attemptFor(uid: string): number | undefined

  // Per-test trace slicing (`test` granularity). Boundary state is shared with
  // the finalizer; flushTraceRange writes one slice via the plugin's context.
  readonly traceMode: boolean
  readonly traceGranularity: TraceGranularity
  readonly specRanges: SpecRange[]
  readonly flushedSpecs: Set<string>
  flushTraceRange(range: SpecRange): Promise<TraceArtifact | undefined>

  /** Produce (no attach) this test's per-test screenshot + video artifacts.
   *  Core-gated to trace mode + `test` granularity. */
  emitTestArtifacts(uid: string | undefined, failed: boolean): Promise<void>
}
