/**
 * Nightwatch DevTools Plugin
 *
 * Integrates Nightwatch with WebdriverIO DevTools following the WDIO service pattern.
 * Captures commands, network requests, and console logs during test execution in real-time.
 */

import { fileURLToPath } from 'node:url'
import {
  deterministicUid,
  errorMessage,
  resolveAdapterOutputDir,
  writeTraceZip,
  type TraceCapturer
} from '@wdio/devtools-core'
import { stop as stopBackend } from '@wdio/devtools-backend'
import { REUSE_ENV, SCREENCAST_DEFAULTS } from '@wdio/devtools-shared'
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
  type CucumberPickle,
  type CucumberPickleStep,
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
import {
  getTestIcon,
  incrementCounters,
  buildPluginMetadataOptions
} from './helpers/utils.js'

const log = logger('@wdio/nightwatch-devtools')

interface SpecRange {
  specFile: string
  commandStartIdx: number
  consoleStartIdx: number
  networkStartIdx: number
  mutationStartIdx: number
  traceLogStartIdx: number
  snapshotCount: number
}

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
      mode,
      traceFormat: options.traceFormat ?? 'zip',
      traceGranularity: options.traceGranularity ?? 'session'
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
      },
      buildMetadataOptions: () => self.#buildMetadataOptions(),
      ensureSessionInitialized: (b) => self.#ensureSessionInitialized(b),
      wrapBrowserOnce: (b) => self.#wrapBrowserOnce(b),
      incrementCount: (s) => self.#incrementCount(s),
      testIcon: (s) => self.#testIcon(s),
      setCucumberRunner: (v) => {
        self.#isCucumberRunner = v
      },
      getRerunLabel: () => self.#getRerunLabel()
    }
    return this.#internals
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
    processedTests: Set<string>
  ): Promise<void> {
    await startNextTest(
      this.#getInternals(),
      currentSuite,
      currentTestName,
      processedTests
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

    // ── Per-spec boundary detection ──
    if (fullPath && this.options.traceGranularity === 'spec') {
      const lastRange = this.#specRanges[this.#specRanges.length - 1]
      if (!lastRange || lastRange.specFile !== fullPath) {
        if (lastRange && !this.#flushedSpecs.has(lastRange.specFile)) {
          void this.#flushSpecTrace(lastRange).catch((err) =>
            log.warn(
              `Failed to flush trace for spec "${lastRange.specFile}": ${errorMessage(err)}`
            )
          )
        }
        this.#specRanges.push({
          specFile: fullPath,
          commandStartIdx: this.sessionCapturer.commandsLog.length,
          consoleStartIdx: this.sessionCapturer.consoleLogs.length,
          networkStartIdx: this.sessionCapturer.networkRequests.length,
          mutationStartIdx: this.sessionCapturer.mutations.length,
          traceLogStartIdx: this.sessionCapturer.traceLogs.length,
          snapshotCount: this.sessionCapturer.actionSnapshots.length
        })
      }
    }

    await this.#closePreviousRunningTest(currentSuite, testFile, currentTest)

    const processedTests = this.testManager.getProcessedTests(testFile)
    const currentTestName = this.#pickCurrentTestName(
      currentTest,
      testNames,
      processedTests
    )
    if (currentTestName) {
      await this.#startNextTest(currentSuite, currentTestName, processedTests)
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
        await this.sessionCapturer.captureTrace(browser)
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
        await this.#writeTraceZipIfNeeded()
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

  async #flushSpecTrace(
    range: SpecRange,
    nextRange?: SpecRange
  ): Promise<string | undefined> {
    if (this.#flushedSpecs.has(range.specFile)) {
      return undefined
    }
    this.#flushedSpecs.add(range.specFile)

    const sessionId = this.sessionCapturer.metadata?.sessionId
    if (!sessionId) {
      return undefined
    }

    const end = nextRange
      ? {
          commands: nextRange.commandStartIdx,
          console: nextRange.consoleStartIdx,
          network: nextRange.networkStartIdx,
          mutations: nextRange.mutationStartIdx,
          traceLogs: nextRange.traceLogStartIdx
        }
      : undefined

    const slice = <T>(arr: T[], start: number, endIdx?: number): T[] =>
      arr.slice(start, endIdx)

    const specCapturer: TraceCapturer = {
      mutations: slice(
        this.sessionCapturer.mutations,
        range.mutationStartIdx,
        end?.mutations
      ),
      traceLogs: slice(
        this.sessionCapturer.traceLogs,
        range.traceLogStartIdx,
        end?.traceLogs
      ),
      consoleLogs: slice(
        this.sessionCapturer.consoleLogs,
        range.consoleStartIdx,
        end?.console
      ),
      networkRequests: slice(
        this.sessionCapturer.networkRequests,
        range.networkStartIdx,
        end?.network
      ),
      commandsLog: slice(
        this.sessionCapturer.commandsLog,
        range.commandStartIdx,
        end?.commands
      ),
      sources: this.sessionCapturer.sources,
      metadata: this.sessionCapturer.metadata
    }

    const specSnapshots = this.sessionCapturer.actionSnapshots.slice(
      range.snapshotCount,
      nextRange?.snapshotCount ?? this.sessionCapturer.actionSnapshots.length
    )

    // Sanitize the spec file path for use as a directory-safe identifier.
    const sanitizedSpec =
      range.specFile
        .replace(/^.*[/\\]/, '')
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/^_+|_+$/g, '') || 'unknown-spec'

    const hash = deterministicUid(range.specFile).split('-').pop()!.slice(0, 8)
    const specSessionId = `${sanitizedSpec}-${hash}-${sessionId.slice(0, 8)}`

    // Collect test metadata for this spec by filtering the suite tree.
    const testMetadata = new Map<string, { title: string; specFile: string }>()
    if (this.suiteManager) {
      for (const suite of this.suiteManager.getAllSuites().values()) {
        for (const entry of suite.tests) {
          if (typeof entry === 'string') {
            continue
          }
          if (entry.file === range.specFile) {
            testMetadata.set(entry.uid, {
              title: entry.fullTitle,
              specFile: entry.file
            })
          }
        }
      }
    }

    const tracePath = await writeTraceZip(specCapturer, {
      outputDir: resolveAdapterOutputDir({
        configPath: this.#configPath
      }),
      sessionId: specSessionId,
      actionSnapshots: specSnapshots.length > 0 ? specSnapshots : undefined,
      format: this.options.traceFormat,
      testMetadata
    })
    log.info(`Trace for spec "${range.specFile}" saved to ${tracePath}`)
    return tracePath
  }

  async #writeTraceZipIfNeeded(): Promise<void> {
    if (this.options.mode !== 'trace' || !this.sessionCapturer) {
      return
    }
    const sessionId = this.sessionCapturer.metadata?.sessionId
    if (!sessionId) {
      return
    }
    try {
      if (this.sessionCapturer.snapshotCaptures.length) {
        await Promise.allSettled(this.sessionCapturer.snapshotCaptures)
      }

      if (this.options.traceGranularity === 'spec') {
        // Per-spec traces — flush any remaining ranges that weren't
        // flushed at spec boundaries (the last spec in the run).
        for (const range of this.#specRanges) {
          if (!this.#flushedSpecs.has(range.specFile)) {
            await this.#flushSpecTrace(range)
          }
        }
        return
      }

      // Session-level trace (default) — single artifact for the
      // entire worker session.
      const testMetadata = new Map<
        string,
        { title: string; specFile: string }
      >()
      if (this.suiteManager) {
        for (const suite of this.suiteManager.getAllSuites().values()) {
          for (const entry of suite.tests) {
            if (typeof entry === 'string') {
              continue
            }
            testMetadata.set(entry.uid, {
              title: entry.fullTitle,
              specFile: entry.file
            })
          }
        }
      }

      const snapshots = this.sessionCapturer.actionSnapshots
      const tracePath = await writeTraceZip(this.sessionCapturer, {
        outputDir: resolveAdapterOutputDir({
          configPath: this.#configPath
        }),
        sessionId,
        actionSnapshots: snapshots.length ? snapshots : undefined,
        format: this.options.traceFormat,
        testMetadata
      })
      log.info(`Trace saved to ${tracePath}`)
    } catch (err) {
      log.warn(`trace write failed: ${errorMessage(err)}`)
    }
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
