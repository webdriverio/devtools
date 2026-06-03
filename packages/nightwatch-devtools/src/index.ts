/**
 * Nightwatch DevTools Plugin
 *
 * Integrates Nightwatch with WebdriverIO DevTools following the WDIO service pattern.
 * Captures commands, network requests, and console logs during test execution in real-time.
 */

import { fileURLToPath } from 'node:url'
import { start } from '@wdio/devtools-backend'
import { errorMessage } from '@wdio/devtools-core'
import { REUSE_ENV, SCREENCAST_DEFAULTS } from '@wdio/devtools-shared'
import logger from '@wdio/logger'
import {
  handleReuseMode,
  openDevtoolsBrowser,
  finalizeAllSuites,
  logRunSummary,
  waitForDevtoolsBrowserClose,
  type RunLifecycleCtx
} from './run-lifecycle.js'
import type { SessionCapturer } from './session.js'
import type { TestReporter } from './reporter.js'
import type { ScreencastRecorder } from './screencast.js'
import type { TestManager } from './helpers/testManager.js'
import type { SuiteManager } from './helpers/suiteManager.js'
import type { BrowserProxy } from './helpers/browserProxy.js'
import {
  TraceType,
  type DevToolsOptions,
  type NightwatchBrowser,
  type ScreencastOptions,
  type TestStats
} from './types.js'
import {
  cucumberBefore as cucumberLifecycleBefore,
  cucumberAfter as cucumberLifecycleAfter,
  cucumberBeforeStep as cucumberLifecycleBeforeStep,
  cucumberAfterStep as cucumberLifecycleAfterStep,
  type CucumberLifecycleCtx
} from './cucumber-lifecycle.js'
import {
  resolveSuiteMetadata,
  pickCurrentTestName,
  startNextTest,
  closePreviousRunningTest,
  wrapBrowserOnce,
  closeOutTestcases,
  type TestLifecycleCtx
} from './test-lifecycle.js'
import {
  ensureSessionInitialized,
  finalizeCurrentScreencast,
  type SessionInitCtx
} from './session-init.js'
import {
  findFreePort,
  resolveNightwatchConfig,
  getTestIcon,
  incrementCounters,
  buildPluginMetadataOptions
} from './helpers/utils.js'
import { TIMING, PLUGIN_GLOBAL_KEY } from './constants.js'

const log = logger('@wdio/nightwatch-devtools')

class NightwatchDevToolsPlugin {
  private options: Required<DevToolsOptions>
  private sessionCapturer!: SessionCapturer
  private testReporter!: TestReporter
  private testManager!: TestManager
  private suiteManager!: SuiteManager
  private browserProxy!: BrowserProxy
  private isScriptInjected = false
  #currentTest: any = null
  #currentScenarioSuite: any = null
  #currentStep: any = null
  #lastSessionId: string | null = null
  #devtoolsBrowser?: WebdriverIO.Browser
  #userDataDir?: string
  #isCucumberRunner = false
  #passCount = 0
  #failCount = 0
  #skipCount = 0
  #configPath: string | undefined
  #srcFolders: string[] = []

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
    this.options = {
      port: options.port ?? 3000,
      hostname: options.hostname ?? 'localhost',
      screencast: options.screencast ?? {},
      bidi: options.bidi ?? false
    }
    this.#screencastOptions = {
      ...SCREENCAST_DEFAULTS,
      ...(options.screencast ?? {})
    }
    this.#bidiEnabled = options.bidi === true
  }

  #runCtx: RunLifecycleCtx | undefined
  #getRunCtx(): RunLifecycleCtx {
    if (this.#runCtx) {
      return this.#runCtx
    }
    const self = this
    this.#runCtx = {
      get options() {
        return self.options
      },
      get testReporter() {
        return self.testReporter
      },
      get suiteManager() {
        return self.suiteManager
      },
      get testManager() {
        return self.testManager
      },
      get sessionCapturer() {
        return self.sessionCapturer
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
      clearExecutionData: () => {
        self.testReporter.clearExecutionData()
        self.suiteManager.clearExecutionData()
      }
    }
    return this.#runCtx
  }

  #handleReuseMode(): void {
    handleReuseMode(this.#getRunCtx())
  }

  async #openDevtoolsBrowser(url: string): Promise<void> {
    await openDevtoolsBrowser(this.#getRunCtx(), url)
  }

  async before() {
    // When relaunched by the DevTools UI rerun button the backend is already
    // running — skip startup and just connect the WebSocket worker.
    const isReuse =
      process.env[REUSE_ENV.REUSE] === '1' &&
      process.env[REUSE_ENV.HOST] &&
      process.env[REUSE_ENV.PORT]

    if (isReuse) {
      this.#handleReuseMode()
    }

    this.#configPath = resolveNightwatchConfig()
    if (this.#configPath) {
      log.info(`✓ Config: ${this.#configPath}`)
    } else {
      log.warn(
        'Could not find nightwatch config — test rerun will be unavailable'
      )
    }

    if (isReuse) {
      // Register the plugin instance so Cucumber hooks can call back into it.
      ;(globalThis as Record<string, unknown>)[PLUGIN_GLOBAL_KEY] = this
      return
    }

    try {
      this.options.port = await findFreePort(
        this.options.port,
        this.options.hostname
      )
      log.info('🚀 Starting DevTools backend...')
      const { port } = await start(this.options)
      this.options.port = port
      const url = `http://${this.options.hostname}:${this.options.port}`
      log.info(`✓ Backend started on port ${this.options.port}`)
      log.info(`  DevTools UI: ${url}`)
      await this.#openDevtoolsBrowser(url)
      await new Promise((resolve) =>
        setTimeout(resolve, TIMING.UI_CONNECTION_WAIT)
      )
      ;(globalThis as Record<string, unknown>)[PLUGIN_GLOBAL_KEY] = this
    } catch (err) {
      log.error(`Failed to start backend: ${errorMessage(err)}`)
      throw err
    }
  }

  #sessionCtx: SessionInitCtx | undefined

  #getSessionCtx(): SessionInitCtx {
    if (this.#sessionCtx) {
      return this.#sessionCtx
    }
    const self = this
    this.#sessionCtx = {
      get hostname() {
        return self.options.hostname
      },
      get port() {
        return self.options.port
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
      getCurrentTest: () => self.#currentTest,
      getCurrentScenarioSuite: () => self.#currentScenarioSuite,
      buildMetadataOptions: () => self.#buildMetadataOptions()
    }
    return this.#sessionCtx
  }

  async #ensureSessionInitialized(browser: NightwatchBrowser) {
    await ensureSessionInitialized(
      this.#getSessionCtx(),
      browser,
      () => this.#finalizeCurrentScreencast()
    )
  }

  async #finalizeCurrentScreencast(): Promise<void> {
    await finalizeCurrentScreencast(this.#getSessionCtx())
  }

  #cucumberCtx: CucumberLifecycleCtx | undefined

  #getCucumberCtx(): CucumberLifecycleCtx {
    if (this.#cucumberCtx) {
      return this.#cucumberCtx
    }
    // `self` reference lets the helper module reach plugin private fields
    // — they're not accessible from outside the class even via `this`.
    const self = this
    this.#cucumberCtx = {
      get sessionCapturer() {
        return self.sessionCapturer
      },
      get testReporter() {
        return self.testReporter
      },
      get testManager() {
        return self.testManager
      },
      get suiteManager() {
        return self.suiteManager
      },
      get browserProxy() {
        return self.browserProxy
      },
      setCucumberRunner: (v) => {
        self.#isCucumberRunner = v
      },
      ensureSessionInitialized: (b) => self.#ensureSessionInitialized(b),
      wrapBrowserOnce: (b) => self.#wrapBrowserOnce(b),
      incrementCount: (s) => self.#incrementCount(s),
      testIcon: (s) => self.#testIcon(s),
      getCurrentScenarioSuite: () => self.#currentScenarioSuite,
      setCurrentScenarioSuite: (s) => {
        self.#currentScenarioSuite = s
      },
      getCurrentStep: () => self.#currentStep,
      setCurrentStep: (s) => {
        self.#currentStep = s
      },
      setCurrentTest: (t) => {
        self.#currentTest = t
      }
    }
    return this.#cucumberCtx
  }

  async cucumberBefore(browser: NightwatchBrowser, pickle: any) {
    await cucumberLifecycleBefore(this.#getCucumberCtx(), browser, pickle)
  }

  async cucumberAfter(browser: NightwatchBrowser, result: any, pickle: any) {
    await cucumberLifecycleAfter(
      this.#getCucumberCtx(),
      browser,
      result,
      pickle
    )
  }

  async cucumberBeforeStep(
    browser: NightwatchBrowser,
    pickleStep: any,
    pickle: any
  ) {
    await cucumberLifecycleBeforeStep(
      this.#getCucumberCtx(),
      browser,
      pickleStep,
      pickle
    )
  }

  async cucumberAfterStep(
    browser: NightwatchBrowser,
    result: any,
    pickleStep: any,
    pickle: any
  ) {
    await cucumberLifecycleAfterStep(
      this.#getCucumberCtx(),
      browser,
      result,
      pickleStep,
      pickle
    )
  }

  #testCtx: TestLifecycleCtx | undefined

  #getTestCtx(): TestLifecycleCtx {
    if (this.#testCtx) {
      return this.#testCtx
    }
    const self = this
    this.#testCtx = {
      get sessionCapturer() {
        return self.sessionCapturer
      },
      get testReporter() {
        return self.testReporter
      },
      get testManager() {
        return self.testManager
      },
      get suiteManager() {
        return self.suiteManager
      },
      get browserProxy() {
        return self.browserProxy
      },
      get srcFolders() {
        return self.#srcFolders
      },
      get isScriptInjected() {
        return self.isScriptInjected
      },
      set isScriptInjected(v: boolean) {
        self.isScriptInjected = v
      },
      getRerunLabel: () => self.#getRerunLabel(),
      incrementCount: (s) => self.#incrementCount(s),
      testIcon: (s) => self.#testIcon(s),
      setCurrentTest: (t) => {
        self.#currentTest = t
      }
    }
    return this.#testCtx
  }

  #resolveSuiteMetadata(currentTest: any) {
    return resolveSuiteMetadata(this.#getTestCtx(), currentTest)
  }

  #pickCurrentTestName(
    currentTest: any,
    testNames: string[],
    processedTests: Set<string>
  ): string | undefined {
    return pickCurrentTestName(currentTest, testNames, processedTests)
  }

  async #startNextTest(
    currentSuite: any,
    currentTestName: string,
    processedTests: Set<string>
  ): Promise<void> {
    await startNextTest(
      this.#getTestCtx(),
      currentSuite,
      currentTestName,
      processedTests
    )
  }

  async #closePreviousRunningTest(
    currentSuite: any,
    testFile: string,
    currentTest: any
  ): Promise<void> {
    await closePreviousRunningTest(
      this.#getTestCtx(),
      currentSuite,
      testFile,
      currentTest
    )
  }

  #wrapBrowserOnce(browser: NightwatchBrowser): void {
    wrapBrowserOnce(this.#getTestCtx(), browser)
  }

  async beforeEach(browser: NightwatchBrowser) {
    if (this.#isCucumberRunner) {
      return
    }
    await this.#ensureSessionInitialized(browser)

    // Nightwatch's `currentTest` is loosely structured (module/results/name);
    // keep it `any` here so per-field access stays terse.
    const currentTest: any = (browser as { currentTest?: unknown }).currentTest
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
    await closeOutTestcases(this.#getTestCtx(), browser)
  }

  async after(browser?: NightwatchBrowser) {
    await this.#finalizeCurrentScreencast()
    try {
      await this.#finalizeAllSuites(browser)
      this.#logRunSummary()
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
    await finalizeAllSuites(this.#getRunCtx(), browser)
  }

  #logRunSummary(): void {
    logRunSummary(this.#getRunCtx())
  }

  async #waitForDevtoolsBrowserClose(): Promise<void> {
    await waitForDevtoolsBrowserClose(this.#getRunCtx())
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

  registerEventHandlers(eventHub: any): void {
    this.#isCucumberRunner = eventHub.runner === 'cucumber'
    if (this.#isCucumberRunner) {
      log.info('✓ Cucumber runner detected via NightwatchEventHub')
    }
    log.info('✓ NightwatchEventHub registered — enriched metadata enabled')

    const handleSessionMetadata = (data: any) => {
      try {
        const { sessionCapabilities, sessionId, testEnv, host, modulePath } =
          data?.metadata ?? {}

        if (this.sessionCapturer && (sessionCapabilities || sessionId)) {
          this.sessionCapturer.sendUpstream('metadata', {
            type: TraceType.Testrunner,
            capabilities: sessionCapabilities ?? {},
            sessionId,
            testEnv,
            host,
            modulePath,
            options: this.#buildMetadataOptions()
          })
        }
      } catch (err) {
        log.error(`Error in event handler: ${errorMessage(err)}`)
      }
    }

    eventHub.on('TestSuiteStarted', handleSessionMetadata)
    eventHub.on('TestRunStarted', handleSessionMetadata)
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

    before: async function (this: any) {
      await plugin.before()
    },
    beforeEach: async function (this: any, browser: NightwatchBrowser) {
      await plugin.beforeEach(browser)
    },
    afterEach: async function (this: any, browser: NightwatchBrowser) {
      await plugin.afterEach(browser)
    },
    after: async function (this: any) {
      await plugin.after()
    },

    registerEventHandlers: function (eventHub: any) {
      plugin.registerEventHandlers(eventHub)
    }
  }
}

export { NightwatchDevToolsPlugin }
