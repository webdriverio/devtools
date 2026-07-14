/**
 * Nightwatch DevTools Plugin
 *
 * Integrates Nightwatch with WebdriverIO DevTools following the WDIO service pattern.
 * Captures commands, network requests, and console logs during test execution in real-time.
 */

import { fileURLToPath } from 'node:url'
import {
  errorMessage,
  finalizeTraceExport,
  flushRangeLogged,
  TestAttemptTracker,
  tracePolicyModeWarning,
  type SpecRange,
  type TraceArtifact,
  type TraceExportContext
} from '@wdio/devtools-core'
import { buildTraceContext } from './trace-context.js'
import { wireAssertCapture } from './helpers/assertCapture.js'
import { stop as stopBackend } from '@wdio/devtools-backend'
import {
  REUSE_ENV,
  SCREENCAST_DEFAULTS,
  type CucumberPickle,
  type CucumberPickleStep
} from '@wdio/devtools-shared'
import logger from '@wdio/logger'
import {
  handleReuseMode,
  openDevtoolsBrowser,
  finalizeAllSuites,
  logRunSummary,
  waitForDevtoolsBrowserClose,
  runPluginBefore,
  type PluginBeforeCtx
} from './run-lifecycle.js'
import type { PluginInternals } from './plugin-internals.js'
import type { SessionCapturer } from './session.js'
import type { TestReporter } from './reporter.js'
import type { ScreencastRecorder } from './screencast.js'
import type { TestManager } from './helpers/testManager.js'
import type { SuiteManager } from './helpers/suiteManager.js'
import type { BrowserProxy } from './helpers/browserProxy.js'
import type {
  DevToolsOptions,
  NightwatchBrowser,
  NightwatchCurrentTest,
  NightwatchEventHub,
  ScreencastOptions,
  SuiteStats,
  TestStats
} from './types.js'
import { registerEventHandlers as registerEventHandlersImpl } from './event-hub.js'
import {
  cucumberBefore as cucumberLifecycleBefore,
  cucumberAfter as cucumberLifecycleAfter,
  cucumberBeforeStep as cucumberLifecycleBeforeStep,
  cucumberAfterStep as cucumberLifecycleAfterStep,
  type CucumberResult
} from './cucumber-lifecycle.js'
import {
  resolveSuiteMetadata,
  pickCurrentTestName,
  startNextTest,
  closePreviousRunningTest,
  wrapBrowserOnce,
  closeOutTestcases
} from './test-lifecycle.js'
import {
  ensureSessionInitialized,
  finalizeCurrentScreencast
} from './session-init.js'
import { captureNativeAssertions } from './helpers/nativeAssertions.js'
import { flushTestSlice, recordSpecSliceBoundary } from './trace-slices.js'
import {
  getTestIcon,
  incrementCounters,
  buildPluginMetadataOptions
} from './helpers/utils.js'

const log = logger('@wdio/nightwatch-devtools')

class NightwatchDevToolsPlugin {
  private options: Required<DevToolsOptions>
  private sessionCapturer!: SessionCapturer
  private testReporter!: TestReporter
  private testManager!: TestManager
  private suiteManager!: SuiteManager
  private browserProxy!: BrowserProxy
  private isScriptInjected = false
  #currentTest: unknown = null
  #currentScenarioSuite: SuiteStats | null = null
  #currentStep: unknown = null
  #lastSessionId: string | null = null
  #devtoolsBrowser?: WebdriverIO.Browser
  #userDataDir?: string
  #isCucumberRunner = false
  #passCount = 0
  #failCount = 0
  #skipCount = 0
  #configPath: string | undefined
  #srcFolders: string[] = []

  /** Index ranges into the session capturer's flat arrays, one per spec file. */
  #specRanges: SpecRange[] = []

  /** Set of spec files already flushed to disk. */
  #flushedSpecs = new Set<string>()

  #getRerunLabel() {
    return process.env[REUSE_ENV.RERUN_ENTRY_TYPE] === 'test'
      ? process.env[REUSE_ENV.RERUN_LABEL]?.trim()
      : undefined
  }

  #screencastOptions: ScreencastOptions
  #screencastRecorder?: ScreencastRecorder
  #screencastSessionId?: string
  #bidiEnabled = false
  #bidiAttachAttempted = false

  // Nightwatch `--retries` and cross-worker reruns may reset this in-process
  // tracker; only retries that re-enter this process's start hook are counted.
  #attemptTracker = new TestAttemptTracker()

  constructor(options: DevToolsOptions = {}) {
    const mode = options.mode ?? 'live'
    const ignore = mode === 'trace' && options.screencast?.enabled === true
    if (ignore) {
      log.warn('trace mode: ignoring screencast option (live-mode feature)')
    }
    const screencast = ignore ? {} : (options.screencast ?? {})
    this.options = {
      port: options.port ?? 3000,
      hostname: options.hostname ?? 'localhost',
      screencast,
      bidi: options.bidi ?? false,
      captureAssertions: options.captureAssertions ?? true,
      mode,
      traceFormat: options.traceFormat ?? 'zip',
      traceGranularity: options.traceGranularity ?? 'session',
      tracePolicy: options.tracePolicy ?? 'on'
    }
    const policyWarning = tracePolicyModeWarning(options.tracePolicy, mode)
    if (policyWarning) {
      log.warn(policyWarning)
    }
    this.#screencastOptions = { ...SCREENCAST_DEFAULTS, ...screencast }
    this.#bidiEnabled = options.bidi === true
  }

  // Single internals "bag" — structurally satisfies all 4 lifecycle ctx
  // interfaces. Lifecycle modules cast it to their narrow type at call time.
  #internals: PluginInternals | undefined
  // Declarative accessor map — splitting this purely to satisfy the
  // line-count rule hurts readability; the body is mechanical wiring.
  // eslint-disable-next-line max-lines-per-function
  #getInternals(): PluginInternals {
    if (this.#internals) {
      return this.#internals
    }
    const self = this
    this.#internals = {
      get options() {
        return self.options
      },
      get hostname() {
        return self.options.hostname
      },
      get port() {
        return self.options.port
      },
      get mode() {
        return self.options.mode
      },
      get screencastOptions() {
        return self.#screencastOptions
      },
      get bidiEnabled() {
        return self.#bidiEnabled
      },
      get captureAssertions() {
        return self.options.captureAssertions
      },
      get sessionCapturer() {
        return self.sessionCapturer
      },
      set sessionCapturer(v) {
        self.sessionCapturer = v
      },
      get testReporter() {
        return self.testReporter
      },
      set testReporter(v) {
        self.testReporter = v
      },
      get testManager() {
        return self.testManager
      },
      set testManager(v) {
        self.testManager = v
      },
      get suiteManager() {
        return self.suiteManager
      },
      set suiteManager(v) {
        self.suiteManager = v
      },
      get browserProxy() {
        return self.browserProxy
      },
      set browserProxy(v) {
        self.browserProxy = v
      },
      get isScriptInjected() {
        return self.isScriptInjected
      },
      set isScriptInjected(v) {
        self.isScriptInjected = v
      },
      get devtoolsBrowser() {
        return self.#devtoolsBrowser
      },
      set devtoolsBrowser(v) {
        self.#devtoolsBrowser = v
      },
      get userDataDir() {
        return self.#userDataDir
      },
      set userDataDir(v) {
        self.#userDataDir = v
      },
      get passCount() {
        return self.#passCount
      },
      set passCount(v) {
        self.#passCount = v
      },
      get failCount() {
        return self.#failCount
      },
      set failCount(v) {
        self.#failCount = v
      },
      get skipCount() {
        return self.#skipCount
      },
      set skipCount(v) {
        self.#skipCount = v
      },
      get lastSessionId() {
        return self.#lastSessionId
      },
      set lastSessionId(v) {
        self.#lastSessionId = v
      },
      get bidiAttachAttempted() {
        return self.#bidiAttachAttempted
      },
      set bidiAttachAttempted(v) {
        self.#bidiAttachAttempted = v
      },
      get srcFolders() {
        return self.#srcFolders
      },
      set srcFolders(v) {
        self.#srcFolders = v
      },
      get screencastRecorder() {
        return self.#screencastRecorder
      },
      set screencastRecorder(v) {
        self.#screencastRecorder = v
      },
      get screencastSessionId() {
        return self.#screencastSessionId
      },
      set screencastSessionId(v) {
        self.#screencastSessionId = v
      },
      get configPath() {
        return self.#configPath
      },
      getCurrentTest: () => self.#currentTest,
      getCurrentScenarioSuite: () => self.#currentScenarioSuite,
      getCurrentStep: () => self.#currentStep,
      setCurrentTest: (t) => {
        self.#currentTest = t
      },
      setCurrentScenarioSuite: (s) => {
        self.#currentScenarioSuite = s
      },
      setCurrentStep: (s) => {
        self.#currentStep = s
      },
      clearExecutionData: () => {
        self.testReporter.clearExecutionData()
        self.suiteManager.clearExecutionData()
        self.#attemptTracker.reset()
      },
      recordAttempt: (uid, specFile) =>
        self.#attemptTracker.recordStart(uid, specFile),
      recordOutcome: (uid, state) =>
        self.#attemptTracker.recordOutcome(uid, state),
      attemptFor: (uid) => self.#attemptTracker.attemptFor(uid),
      buildMetadataOptions: () => self.#buildMetadataOptions(),
      ensureSessionInitialized: (b) => self.#ensureSessionInitialized(b),
      wrapBrowserOnce: (b) => self.#wrapBrowserOnce(b),
      incrementCount: (s) => self.#incrementCount(s),
      testIcon: (s) => self.#testIcon(s),
      setCucumberRunner: (v) => {
        self.#isCucumberRunner = v
      },
      getRerunLabel: () => self.#getRerunLabel(),
      get traceMode() {
        return self.options.mode === 'trace'
      },
      get traceGranularity() {
        return self.options.traceGranularity
      },
      get specRanges() {
        return self.#specRanges
      },
      get flushedSpecs() {
        return self.#flushedSpecs
      },
      flushTraceRange: (range) => self.#flushSpecTrace(range)
    }
    return this.#internals
  }

  /** Boundary cast: currentTest is Nightwatch's loose bag; only uid is read. */
  #currentTestUid(): string | undefined {
    return (this.#currentTest as { uid?: string } | null)?.uid
  }

  #handleReuseMode(): void {
    handleReuseMode(this.#getInternals())
  }

  async #openDevtoolsBrowser(url: string): Promise<void> {
    await openDevtoolsBrowser(this.#getInternals(), url)
  }

  async before() {
    const internals = this.#getInternals() as unknown as PluginBeforeCtx
    internals.setConfigPath = (v) => {
      this.#configPath = v
    }
    internals.openDevtoolsBrowserAt = (url) => this.#openDevtoolsBrowser(url)
    internals.handleReuse = () => this.#handleReuseMode()
    internals.plugin = this
    await runPluginBefore(internals)
    if (this.options.captureAssertions) {
      wireAssertCapture(
        () => this.sessionCapturer,
        () => this.#currentTestUid()
      )
    }
  }

  async #ensureSessionInitialized(browser: NightwatchBrowser) {
    await ensureSessionInitialized(this.#getInternals(), browser, () =>
      this.#finalizeCurrentScreencast()
    )
  }

  async #finalizeCurrentScreencast(): Promise<void> {
    await finalizeCurrentScreencast(this.#getInternals())
  }

  async cucumberBefore(browser: NightwatchBrowser, pickle: CucumberPickle) {
    await cucumberLifecycleBefore(this.#getInternals(), browser, pickle)
  }

  async cucumberAfter(
    browser: NightwatchBrowser,
    result: CucumberResult,
    pickle: CucumberPickle
  ) {
    await cucumberLifecycleAfter(this.#getInternals(), browser, result, pickle)
  }

  async cucumberBeforeStep(
    browser: NightwatchBrowser,
    pickleStep: CucumberPickleStep,
    pickle: CucumberPickle
  ) {
    await cucumberLifecycleBeforeStep(
      this.#getInternals(),
      browser,
      pickleStep,
      pickle
    )
  }

  async cucumberAfterStep(
    browser: NightwatchBrowser,
    result: CucumberResult,
    pickleStep: CucumberPickleStep,
    pickle: CucumberPickle
  ) {
    await cucumberLifecycleAfterStep(
      this.#getInternals(),
      browser,
      result,
      pickleStep,
      pickle
    )
  }

  #resolveSuiteMetadata(currentTest: NightwatchCurrentTest) {
    return resolveSuiteMetadata(this.#getInternals(), currentTest)
  }

  #pickCurrentTestName(
    currentTest: NightwatchCurrentTest,
    testNames: string[],
    processedTests: Set<string>
  ): string | undefined {
    return pickCurrentTestName(currentTest, testNames, processedTests)
  }

  async #startNextTest(
    currentSuite: SuiteStats,
    currentTestName: string,
    processedTests: Set<string>,
    specFile: string | null
  ): Promise<void> {
    await startNextTest(
      this.#getInternals(),
      currentSuite,
      currentTestName,
      processedTests,
      specFile
    )
  }

  async #closePreviousRunningTest(
    currentSuite: SuiteStats,
    testFile: string,
    currentTest: NightwatchCurrentTest
  ): Promise<void> {
    await closePreviousRunningTest(
      this.#getInternals(),
      currentSuite,
      testFile,
      currentTest
    )
  }

  #wrapBrowserOnce(browser: NightwatchBrowser): void {
    wrapBrowserOnce(this.#getInternals(), browser)
  }

  async beforeEach(browser: NightwatchBrowser) {
    if (this.#isCucumberRunner) {
      return
    }
    await this.#ensureSessionInitialized(browser)

    const currentTest = browser.currentTest as NightwatchCurrentTest | undefined
    if (!currentTest) {
      return
    }

    const { testFile, fullPath, suiteTitle, testNames, suiteLine, testLines } =
      this.#resolveSuiteMetadata(currentTest)
    const currentSuite = this.suiteManager.getOrCreateSuite(
      testFile,
      suiteTitle,
      fullPath,
      testNames,
      suiteLine,
      testLines
    )
    if (fullPath && fullPath.includes('/')) {
      this.sessionCapturer.captureSource(fullPath).catch(() => {})
    }

    if (fullPath) {
      recordSpecSliceBoundary(this.#getInternals(), fullPath)
    }

    await this.#closePreviousRunningTest(currentSuite, testFile, currentTest)

    const processedTests = this.testManager.getProcessedTests(testFile)
    const currentTestName = this.#pickCurrentTestName(
      currentTest,
      testNames,
      processedTests
    )
    if (currentTestName) {
      await this.#startNextTest(
        currentSuite,
        currentTestName,
        processedTests,
        fullPath
      )
    }
    this.#wrapBrowserOnce(browser)
  }

  async afterEach(browser: NightwatchBrowser) {
    // Cucumber runner manages its own lifecycle via cucumberHooks.cjs
    if (this.#isCucumberRunner) {
      return
    }

    if (browser && this.sessionCapturer) {
      try {
        await this.#closeOutTestcases(browser)
        if (this.options.captureAssertions) {
          await captureNativeAssertions(
            this.sessionCapturer,
            browser,
            browser.currentTest as NightwatchCurrentTest | undefined,
            this.#currentTestUid(),
            this.browserProxy.drainNativeAssertCalls()
          )
        }
        await this.sessionCapturer.captureTrace(browser)
        // Flush this test's slice before the next test overwrites its outcome.
        flushTestSlice(this.#getInternals())
      } catch (err) {
        log.error(`Failed to capture trace: ${errorMessage(err)}`)
      }
    }
  }

  async #closeOutTestcases(browser: NightwatchBrowser): Promise<void> {
    await closeOutTestcases(this.#getInternals(), browser)
  }

  async after(browser?: NightwatchBrowser) {
    await this.#finalizeCurrentScreencast()
    try {
      await this.#finalizeAllSuites(browser)
      this.#logRunSummary()
      if (this.options.mode === 'trace') {
        await this.#writeTraceIfNeeded()
        await this.sessionCapturer?.closeWebSocket()
        await stopBackend()
        return
      }
      if (!this.#devtoolsBrowser) {
        // Reuse mode: force one final suites broadcast so the UI reflects the
        // actual outcome before the process exits.
        this.testReporter?.updateSuites()
        log.info('♻  Rerun complete — flushing WebSocket...')
        await this.sessionCapturer?.closeWebSocket()
        return
      }
      log.info('💡 Please close the DevTools browser window to finish...')
      await this.#waitForDevtoolsBrowserClose()
    } catch (err) {
      log.error(`Failed to stop backend: ${errorMessage(err)}`)
    }
  }

  async #finalizeAllSuites(browser?: NightwatchBrowser): Promise<void> {
    await finalizeAllSuites(this.#getInternals(), browser)
  }

  #logRunSummary(): void {
    logRunSummary(this.#getInternals())
  }

  /** Thin wrapper so boundary flushes and the final flush share one path.
   *  flushRangeLogged logs+swallows a failed flush (shared spec/test string) so
   *  the fire-and-forget boundary callers don't each re-implement the guard. */
  #flushSpecTrace(range: SpecRange): Promise<TraceArtifact | undefined> {
    const sessionId = this.sessionCapturer.metadata?.sessionId
    if (!sessionId) {
      return Promise.resolve(undefined)
    }
    return flushRangeLogged(this.#traceContext(sessionId), range)
  }

  /** Assemble the framework-agnostic trace-export context from plugin state.
   *  Output dir ignores the spec range — nightwatch writes next to config. */
  #traceContext(sessionId: string): TraceExportContext {
    return buildTraceContext(
      {
        mode: this.options.mode,
        policy: this.options.tracePolicy,
        granularity: this.options.traceGranularity,
        format: this.options.traceFormat,
        capturer: this.sessionCapturer,
        suites: this.suiteManager.getAllSuites().values(),
        outcomes: this.#attemptTracker,
        ranges: this.#specRanges,
        flushed: this.#flushedSpecs,
        configPath: this.#configPath,
        testFilePath:
          this.browserProxy?.getCurrentTestFullPath?.() ?? undefined,
        log: (level, msg) => log[level](msg)
      },
      sessionId
    )
  }

  async #writeTraceIfNeeded(): Promise<void> {
    const sessionId = this.sessionCapturer?.metadata?.sessionId
    if (this.options.mode !== 'trace' || !this.sessionCapturer || !sessionId) {
      return
    }
    await finalizeTraceExport(this.#traceContext(sessionId))
  }

  async #waitForDevtoolsBrowserClose(): Promise<void> {
    await waitForDevtoolsBrowserClose(this.#getInternals())
  }

  #buildMetadataOptions() {
    return buildPluginMetadataOptions({
      isCucumberRunner: this.#isCucumberRunner,
      configPath: this.#configPath
    })
  }

  #incrementCount(state: TestStats['state']): void {
    const counters = {
      passCount: this.#passCount,
      failCount: this.#failCount,
      skipCount: this.#skipCount
    }
    incrementCounters(counters, state)
    this.#passCount = counters.passCount
    this.#failCount = counters.failCount
    this.#skipCount = counters.skipCount
  }

  #testIcon(state: TestStats['state']): string {
    return getTestIcon(state)
  }

  registerEventHandlers(eventHub: NightwatchEventHub): void {
    registerEventHandlersImpl(eventHub, {
      getSessionCapturer: () => this.sessionCapturer,
      buildMetadataOptions: () => this.#buildMetadataOptions(),
      setCucumberRunner: (v: boolean) => {
        this.#isCucumberRunner = v
      }
    })
  }
}

export const cucumberHooksPath = fileURLToPath(
  new URL('./helpers/cucumberHooks.cjs', import.meta.url)
)

export default function createNightwatchDevTools(options?: DevToolsOptions) {
  const plugin = new NightwatchDevToolsPlugin(options)

  return {
    // Set long timeout to allow user to review DevTools UI
    // The after() hook waits for the browser window to be closed
    asyncHookTimeout: 3600000,

    before: async function (this: unknown) {
      await plugin.before()
    },
    beforeEach: async function (this: unknown, browser: NightwatchBrowser) {
      await plugin.beforeEach(browser)
    },
    afterEach: async function (this: unknown, browser: NightwatchBrowser) {
      await plugin.afterEach(browser)
    },
    after: async function (this: unknown) {
      await plugin.after()
    },

    registerEventHandlers: function (eventHub: NightwatchEventHub) {
      plugin.registerEventHandlers(eventHub)
    }
  }
}

export { NightwatchDevToolsPlugin }
