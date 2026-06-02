/**
 * Nightwatch DevTools Plugin
 *
 * Integrates Nightwatch with WebdriverIO DevTools following the WDIO service pattern.
 * Captures commands, network requests, and console logs during test execution in real-time.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { fileURLToPath } from 'node:url'
import { start, stop } from '@wdio/devtools-backend'
import { errorMessage, finalizeScreencast } from '@wdio/devtools-core'
import { REUSE_ENV, SCREENCAST_DEFAULTS, WS_SCOPE } from '@wdio/devtools-shared'
import logger from '@wdio/logger'
import { remote } from 'webdriverio'
import { SessionCapturer } from './session.js'
import { TestReporter } from './reporter.js'
import { ScreencastRecorder } from './screencast.js'
import { TestManager } from './helpers/testManager.js'
import { SuiteManager } from './helpers/suiteManager.js'
import { BrowserProxy } from './helpers/browserProxy.js'
import {
  TraceType,
  type DevToolsOptions,
  type NightwatchBrowser,
  type ScreencastOptions,
  type SuiteStats,
  type TestStats
} from './types.js'
import { resolveSpecFilePath } from './helpers/specFileResolver.js'
import {
  closeOpenSteps,
  cucumberResultToTestState
} from './helpers/cucumberResult.js'
import { buildCucumberScenarioSuite } from './helpers/cucumberScenarioBuilder.js'
import { closePreviousTest } from './helpers/closePreviousTest.js'
import { scanFeatureFile } from './helpers/featureFileScan.js'
import {
  determineTestState,
  extractTestMetadata,
  parseCucumberScenario,
  findFreePort,
  resolveNightwatchConfig
} from './helpers/utils.js'
import { DEFAULTS, TIMING, TEST_STATE, PLUGIN_GLOBAL_KEY } from './constants.js'

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

  async before() {
    // When relaunched by the DevTools UI rerun button the backend is already
    // running — skip startup and just connect the WebSocket worker.
    const isReuse =
      process.env[REUSE_ENV.REUSE] === '1' &&
      process.env[REUSE_ENV.HOST] &&
      process.env[REUSE_ENV.PORT]

    if (isReuse) {
      this.options.hostname = process.env[REUSE_ENV.HOST]!
      this.options.port = Number(process.env[REUSE_ENV.PORT])
      log.info(
        `♻  Reusing DevTools backend at ${this.options.hostname}:${this.options.port}`
      )
      // Clear execution data from the previous run when rerunning
      // This ensures test names cache and suites are fresh for the new run
      if (this.testReporter) {
        this.testReporter.clearExecutionData()
        this.suiteManager.clearExecutionData()
        // Reset counters for fresh run
        this.#passCount = 0
        this.#failCount = 0
        this.#skipCount = 0
        log.info('Cleared execution data for rerun')
      }
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

      try {
        // Create unique user data directory for this instance to prevent conflicts
        this.#userDataDir = path.join(
          os.tmpdir(),
          `nightwatch-devtools-${this.options.port}-${Date.now()}`
        )

        if (!fs.existsSync(this.#userDataDir)) {
          fs.mkdirSync(this.#userDataDir, { recursive: true })
        }

        this.#devtoolsBrowser = await remote({
          logLevel: 'info',
          automationProtocol: 'devtools',
          capabilities: {
            browserName: 'chrome',
            'goog:chromeOptions': {
              args: [
                '--window-size=1600,1200',
                `--user-data-dir=${this.#userDataDir}`,
                '--no-first-run',
                '--no-default-browser-check'
              ]
            }
          }
        })

        await this.#devtoolsBrowser.url(url)
      } catch (err) {
        log.error(`Failed to open DevTools UI: ${errorMessage(err)}`)
        log.info(`Please manually open: ${url}`)
      }

      await new Promise((resolve) =>
        setTimeout(resolve, TIMING.UI_CONNECTION_WAIT)
      )
      ;(globalThis as Record<string, unknown>)[PLUGIN_GLOBAL_KEY] = this
    } catch (err) {
      log.error(`Failed to start backend: ${errorMessage(err)}`)
      throw err
    }
  }

  async #ensureSessionInitialized(browser: NightwatchBrowser) {
    const currentSessionId = browser.sessionId
    const isSessionChange =
      currentSessionId &&
      this.#lastSessionId &&
      currentSessionId !== this.#lastSessionId

    if (isSessionChange) {
      log.info('Browser session changed — reconnecting WebSocket only')
      this.isScriptInjected = false
      // Reset BiDi-attach state so the new session gets its own attach —
      // inspectors are bound to a specific driver instance and don't carry
      // across sessions. Without this, only the first session captures via
      // BiDi and the rest silently fall back to the perf-log path.
      this.#bidiAttachAttempted = false
      // Finalize the previous session's screencast BEFORE we tear down its
      // capturer — encode + broadcast use the existing WS connection.
      await this.#finalizeCurrentScreencast()
      this.sessionCapturer?.cleanup()
      // Intentional null-out — the next `#ensureSessionInitialized` call
      // reassigns. Cast through unknown so the strict field type passes.
      this.sessionCapturer = null as unknown as SessionCapturer
    }
    this.#lastSessionId = currentSessionId ?? null

    if (this.sessionCapturer) {
      return
    }

    await new Promise((resolve) =>
      setTimeout(resolve, TIMING.INITIAL_CONNECTION_WAIT)
    )

    this.sessionCapturer = new SessionCapturer(
      { port: this.options.port, hostname: this.options.hostname },
      browser
    )

    const connected = await this.sessionCapturer.waitForConnection(3000)
    if (!connected) {
      log.error('❌ Worker WebSocket failed to connect!')
    }

    if (!this.testReporter) {
      // First-time setup: create reporter chain once for the entire run.
      // These must NOT be recreated on session change — doing so generates a
      // new feature suite with a fresh start timestamp, which DataManager sees
      // as a new run and wipes all accumulated commands.
      this.testReporter = new TestReporter((suitesData: any) => {
        if (this.sessionCapturer) {
          this.sessionCapturer.sendUpstream('suites', suitesData)
        }
      })
      this.testManager = new TestManager(this.testReporter)
      this.suiteManager = new SuiteManager(this.testReporter)
      this.browserProxy = new BrowserProxy(
        this.sessionCapturer,
        this.testManager,
        () => this.#currentTest ?? this.#currentScenarioSuite
      )
    } else {
      // Session change: update the reporter's upstream callback to use the new
      // WebSocket, update the proxy's capturer reference (avoids re-wrapping
      // already-wrapped browser methods which would double-capture commands),
      // then replay current suite state to the newly-connected UI.
      this.testReporter.updateUpstream((suitesData: any) => {
        if (this.sessionCapturer) {
          this.sessionCapturer.sendUpstream('suites', suitesData)
        }
      })
      this.browserProxy.updateSessionCapturer(this.sessionCapturer)
      this.testReporter.updateSuites()
    }

    const capabilities = browser.capabilities || {}
    const desiredCapabilities = browser.desiredCapabilities || {}
    const sessionId = browser.sessionId
    const opts = browser.options || {}

    // Capture src_folders once so beforeEach can resolve test file paths
    if (this.#srcFolders.length === 0) {
      const sf = (opts as { src_folders?: string | string[] }).src_folders
      this.#srcFolders = Array.isArray(sf) ? sf : sf ? [sf] : []
    }

    this.sessionCapturer.sendUpstream('metadata', {
      type: TraceType.Testrunner,
      capabilities,
      desiredCapabilities,
      sessionId,
      testEnv: opts.testEnv,
      host: opts.webdriver?.host,
      options: this.#buildMetadataOptions(),
      url: ''
    })

    const browserName =
      capabilities.browserName || desiredCapabilities.browserName || 'unknown'
    const browserVersion =
      capabilities.browserVersion ||
      (capabilities as { version?: string }).version ||
      ''
    log.info(
      `✓ Browser: ${browserName}${browserVersion ? ' ' + browserVersion : ''} (session: ${sessionId})`
    )

    const loggingPrefs = ((capabilities as Record<string, unknown>)[
      'goog:loggingPrefs'
    ] ||
      (desiredCapabilities as Record<string, unknown>)['goog:loggingPrefs'] ||
      {}) as { performance?: string }
    if (!loggingPrefs.performance && !this.#bidiEnabled) {
      log.warn(
        "⚠  Network tab will be empty — add 'goog:loggingPrefs': { performance: 'ALL' } to your capabilities (or enable bidi:true)"
      )
    }

    // BiDi: opt-in. Requires `webSocketUrl: true` capability + a BiDi-capable
    // chromedriver. We attempt once per session; on failure or unavailability
    // the perf-log fallback path continues to work.
    if (this.#bidiEnabled && !this.#bidiAttachAttempted) {
      this.#bidiAttachAttempted = true
      const driver = (browser as { driver?: unknown }).driver
      if (driver) {
        const { attachBidiHandlers, buildBidiSinks } = await import('./bidi.js')
        const ok = await attachBidiHandlers(
          driver,
          buildBidiSinks(this.sessionCapturer)
        )
        if (ok) {
          this.sessionCapturer.bidiActive = true
          log.info('✓ BiDi attached — perf-log network capture disabled')
        }
      } else {
        log.warn('bidi:true set but browser.driver unavailable — skipping')
      }
    }

    // Screencast: start a fresh recorder per browser session — every
    // reloadSession / per-test browser produces its own .webm, matching
    // the WDIO service behavior. Polling mode only (Nightwatch has no
    // stable CDP escape hatch). Finalized when the next session change
    // fires or when after() runs.
    if (
      this.#screencastOptions.enabled &&
      !this.#screencastRecorder &&
      sessionId
    ) {
      this.#screencastRecorder = new ScreencastRecorder(
        this.sessionCapturer,
        this.#screencastOptions
      )
      this.#screencastSessionId = sessionId
      log.info(`🎬 Starting screencast for session ${sessionId}`)
      await this.#screencastRecorder.start(browser)
    }
  }

  /**
   * Stop, encode, and broadcast the current session's screencast (if any),
   * then clear state so the next `#ensureSessionInitialized` call starts a
   * fresh recorder. Safe to call multiple times — no-op when nothing is
   * recording.
   */
  async #finalizeCurrentScreencast(): Promise<void> {
    if (!this.#screencastRecorder || !this.#screencastSessionId) {
      return
    }
    await finalizeScreencast({
      recorder: this.#screencastRecorder,
      sessionId: this.#screencastSessionId,
      filenamePrefix: 'nightwatch-video',
      outputDir: process.cwd(),
      captureFormat: this.#screencastOptions.captureFormat,
      sendUpstream: (scope, data) =>
        this.sessionCapturer?.sendUpstream(scope, data),
      onLog: (level, message) => log[level](message)
    })
    this.#screencastRecorder = undefined
    this.#screencastSessionId = undefined
  }

  async cucumberBefore(browser: NightwatchBrowser, pickle: any) {
    this.#isCucumberRunner = true
    await this.#initCucumberScenario(browser, pickle)
  }

  async cucumberAfter(browser: NightwatchBrowser, result: any, pickle: any) {
    await this.#finalizeCucumberScenario(browser, result, pickle)
  }

  /** Called from Cucumber Before hook (order:1000) — one call per scenario. */
  async #initCucumberScenario(browser: NightwatchBrowser, pickle: any) {
    await this.#ensureSessionInitialized(browser)

    const featureUri: string = pickle.uri ?? 'unknown.feature'
    const scenarioName: string = pickle.name ?? 'Unknown Scenario'

    const {
      featureName,
      featureContent,
      featureAbsPath,
      stepDefFiles,
      capturedPaths
    } = scanFeatureFile(featureUri)
    for (const p of capturedPaths) {
      this.sessionCapturer.captureSource(p).catch(() => {})
    }

    // Get or create the feature-level suite (no individual test names — scenarios go into suites[])
    const featureSuite = this.suiteManager.getOrCreateSuite(
      featureUri,
      featureName,
      featureUri,
      []
    )
    this.suiteManager.markSuiteAsRunning(featureSuite)

    // Parse step keywords from the feature file
    const steps: Array<{ text: string }> = pickle.steps ?? []

    // Parse line numbers and keywords for TestLens navigation and step labels
    const { featureLine, scenarioLine, stepLines, stepKeywords } =
      parseCucumberScenario(
        featureContent,
        scenarioName,
        steps.map((s) => s.text)
      )
    if (featureAbsPath && featureLine > 0) {
      featureSuite.callSource = `${featureAbsPath}:${featureLine}`
    }

    const scenarioSuite = buildCucumberScenarioSuite({
      featureUri,
      scenarioName,
      featureName,
      featureAbsPath,
      stepDefFiles,
      steps,
      stepLines,
      stepKeywords,
      scenarioLine,
      parentFeatureSuiteUid: featureSuite.uid
    })

    // Add scenario sub-suite to the feature suite.
    // If a suite with this uid already exists it means this is a RETRY of the same
    // scenario — clear execution data so only the latest attempt's commands are shown.
    const existingIdx = featureSuite.suites.findIndex(
      (s: SuiteStats) => s.uid === scenarioSuite.uid
    )
    if (existingIdx !== -1) {
      featureSuite.suites[existingIdx] = scenarioSuite
      // Pass the specific scenario uid so only this scenario's execution data
      // is reset — a uid-less clearExecutionData would mark ALL suites as
      // running, destroying the previous terminal states of sibling scenarios.
      this.sessionCapturer.sendUpstream(WS_SCOPE.clearExecutionData, {
        uid: scenarioSuite.uid,
        entryType: 'suite'
      })
    } else {
      featureSuite.suites.push(scenarioSuite)
    }

    this.#currentScenarioSuite = scenarioSuite
    this.#currentStep = null
    this.#currentTest = null

    this.testReporter.updateSuites()

    if (!this.isScriptInjected) {
      this.browserProxy.wrapUrlMethod(browser)
      this.isScriptInjected = true
    }
    this.browserProxy.wrapBrowserCommands(browser)
    this.browserProxy.resetCommandTracking()

    log.info(`🥒 Scenario: ${scenarioName}`)
  }

  /** Called from Cucumber After hook (order:1000) — one call per scenario. */
  async #finalizeCucumberScenario(
    browser: NightwatchBrowser,
    result: any,
    pickle: any
  ) {
    try {
      const scenarioState = cucumberResultToTestState(result)
      const scenario = this.#currentScenarioSuite
      if (scenario) {
        const now = new Date()
        const duration =
          now.getTime() - (scenario.start?.getTime() ?? now.getTime())
        scenario.state = scenarioState
        scenario.end = now
        scenario._duration = duration
        closeOpenSteps(scenario, scenarioState, now)

        const featureUri: string = pickle?.uri ?? 'unknown.feature'
        this.testManager.markTestAsProcessed(featureUri, pickle?.name ?? '')

        const featureSuite = this.suiteManager.getSuite(featureUri)
        if (featureSuite) {
          // Finalize is not called until all scenarios are done — just update state
          this.suiteManager.finalizeSuiteState(featureSuite)
        }

        this.#incrementCount(scenarioState)
        const icon = this.#testIcon(scenarioState)
        log.info(
          `  ${icon} ${pickle?.name ?? 'Unknown'} (${(duration / 1000).toFixed(2)}s)`
        )

        this.testReporter.updateSuites()
        this.#currentScenarioSuite = null
        this.#currentStep = null
        this.#currentTest = null
      }

      await this.sessionCapturer.captureTrace(browser)
    } catch (err) {
      log.error(`Failed to finalize Cucumber scenario: ${errorMessage(err)}`)
    }
  }

  /** Called from Cucumber BeforeStep hook — marks the step as running. */
  async cucumberBeforeStep(
    browser: NightwatchBrowser,
    pickleStep: any,
    _pickle: any
  ) {
    if (!this.#currentScenarioSuite) {
      return
    }

    // Reset per-step dedup tracking so commands in step N are never
    // mistaken for retries of identically-signatured commands from step N-1.
    this.browserProxy?.resetCommandTracking()

    const stepText: string = pickleStep?.text ?? ''
    type MutStep = {
      title?: string
      state?: string
      start?: Date | null
      end?: Date | null
    }
    const step = (
      this.#currentScenarioSuite.tests as Array<MutStep | string>
    ).find(
      (t): t is MutStep =>
        typeof t !== 'string' &&
        (t.title?.endsWith(stepText) === true || t.title === stepText)
    )
    if (step) {
      step.state = TEST_STATE.RUNNING
      step.start = new Date()
      step.end = null
      this.#currentStep = step
      this.testReporter.updateSuites()
    }
  }

  /** Called from Cucumber AfterStep hook — records the step result. */
  async cucumberAfterStep(
    _browser: NightwatchBrowser,
    result: any,
    pickleStep: any,
    _pickle: any
  ) {
    const step = this.#currentStep
    if (!step) {
      return
    }
    const status = String(result?.status ?? 'UNKNOWN').toUpperCase()
    const stepState: TestStats['state'] =
      status === 'PASSED'
        ? TEST_STATE.PASSED
        : status === 'SKIPPED'
          ? TEST_STATE.SKIPPED
          : TEST_STATE.FAILED
    step.state = stepState
    step.end = new Date()
    step._duration = Date.now() - (step.start?.getTime() ?? Date.now())
    this.#currentStep = null
    this.testReporter.updateSuites()
    void pickleStep // used by BeforeStep to find the step
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

    const testFile =
      (currentTest.module || '').split('/').pop() ||
      currentTest.module ||
      DEFAULTS.FILE_NAME

    const fullPath = resolveSpecFilePath(
      testFile,
      currentTest.module,
      this.#srcFolders,
      this.browserProxy.getCurrentTestFullPath() || undefined
    )

    // Extract suite title and test metadata
    let suiteTitle = testFile
    if (!fullPath) {
      log.warn(
        `[beforeEach] Could not resolve file path for "${testFile}" — source view will be unavailable`
      )
    }
    let testNames: string[] = []
    let suiteLine: number | null = null
    let testLines: number[] = []
    if (fullPath) {
      const {
        suiteTitle: parsedTitle,
        testNames: parsedNames,
        suiteLine: parsedSuiteLine,
        testLines: parsedTestLines
      } = extractTestMetadata(fullPath)
      if (parsedTitle) {
        suiteTitle = parsedTitle
      }
      testNames = parsedNames
      suiteLine = parsedSuiteLine
      testLines = parsedTestLines
    }

    const rerunLabel = this.#getRerunLabel()
    if (rerunLabel) {
      const targetIndex = testNames.findIndex((name) => name === rerunLabel)
      if (targetIndex !== -1) {
        testNames = [testNames[targetIndex]]
        testLines = testLines[targetIndex] ? [testLines[targetIndex]] : []
      }
    }

    // Get or create suite for this test file
    const currentSuite = this.suiteManager.getOrCreateSuite(
      testFile,
      suiteTitle,
      fullPath,
      testNames,
      suiteLine,
      testLines
    )

    // Capture source file for display
    if (fullPath && fullPath.includes('/')) {
      this.sessionCapturer.captureSource(fullPath).catch(() => {})
    }

    const runningTest = currentSuite.tests.find(
      (t: any) => typeof t !== 'string' && t.state === TEST_STATE.RUNNING
    ) as TestStats | undefined

    if (runningTest) {
      await closePreviousTest({
        runningTest,
        testFile,
        testcases: currentTest?.results?.testcases || {},
        testManager: this.testManager,
        incrementCount: (state) => this.#incrementCount(state),
        testIcon: (state) => this.#testIcon(state)
      })
    }

    const processedTests = this.testManager.getProcessedTests(testFile)
    const runtimeTestName =
      typeof currentTest?.name === 'string'
        ? currentTest.name.trim()
        : undefined
    const matchedRuntimeTestName = runtimeTestName
      ? testNames.find(
          (name) =>
            runtimeTestName === name || runtimeTestName.endsWith(` ${name}`)
        )
      : undefined
    const currentTestName =
      matchedRuntimeTestName ||
      testNames.find((name) => !processedTests.has(name))

    if (currentTestName) {
      if (processedTests.size === 0) {
        this.suiteManager.markSuiteAsRunning(currentSuite)
      }

      const test = this.testManager.findTestInSuite(
        currentSuite,
        currentTestName
      )
      if (test) {
        test.state = TEST_STATE.RUNNING as TestStats['state']
        test.start = new Date()
        test.end = null
        this.testReporter.onTestStart(test)
        this.#currentTest = test
        log.info(`  ▶ ${currentTestName}`)
        await new Promise((resolve) =>
          setTimeout(resolve, TIMING.TEST_START_DELAY)
        )
      } else {
        log.warn(
          `Test "${currentTestName}" not found in suite "${currentSuite.title}"`
        )
        this.#currentTest = null
      }
    }

    if (!this.isScriptInjected) {
      this.browserProxy.wrapUrlMethod(browser)
      this.isScriptInjected = true
    }
    this.browserProxy.resetCommandTracking()
    this.browserProxy.wrapBrowserCommands(browser)
  }

  async afterEach(browser: NightwatchBrowser) {
    // Cucumber runner manages its own lifecycle via cucumberHooks.cjs
    if (this.#isCucumberRunner) {
      return
    }

    if (browser && this.sessionCapturer) {
      try {
        // Nightwatch's `currentTest` is loosely structured
        // (module/results/name); keep it `any` here so per-field access
        // stays terse.
        const currentTest: any = (browser as { currentTest?: unknown })
          .currentTest
        const results = currentTest?.results || {}
        const testFile =
          (currentTest.module || '').split('/').pop() || DEFAULTS.FILE_NAME
        const testcases = results.testcases || {}
        const testcaseNames = Object.keys(testcases)

        const currentSuite = this.suiteManager.getSuite(testFile)
        if (currentSuite) {
          const processedTests = this.testManager.getProcessedTests(testFile)

          if (testcaseNames.length === 0) {
            const runningTest = currentSuite.tests.find(
              (t: any) =>
                typeof t !== 'string' && t.state === TEST_STATE.RUNNING
            ) as TestStats | undefined

            if (runningTest && !processedTests.has(runningTest.title)) {
              const testState: TestStats['state'] =
                results.errors > 0 || results.failed > 0
                  ? TEST_STATE.FAILED
                  : TEST_STATE.PASSED
              const endTime = new Date()
              const duration =
                endTime.getTime() - (runningTest.start?.getTime() || 0)

              this.testManager.updateTestState(
                runningTest,
                testState,
                endTime,
                duration
              )
              this.testManager.markTestAsProcessed(testFile, runningTest.title)
              this.#incrementCount(testState)
              const icon = this.#testIcon(testState)
              log.info(
                `  ${icon} ${runningTest.title} (${(duration / 1000).toFixed(2)}s)`
              )
            }
          } else {
            const unprocessedTests = testcaseNames.filter(
              (name) => !processedTests.has(name)
            )

            for (const currentTestName of unprocessedTests) {
              const testcase = testcases[currentTestName]
              const testState = determineTestState(testcase)

              const test = this.testManager.findTestInSuite(
                currentSuite,
                currentTestName
              )
              if (test) {
                const dur = parseFloat(testcase.time || '0') * 1000
                this.testManager.updateTestState(
                  test,
                  testState,
                  new Date(),
                  dur
                )
                this.#incrementCount(testState)
                const icon = this.#testIcon(testState)
                log.info(
                  `  ${icon} ${currentTestName} (${(dur / 1000).toFixed(2)}s)`
                )
              }

              this.testManager.markTestAsProcessed(testFile, currentTestName)
            }

            if (processedTests.size === testcaseNames.length) {
              this.suiteManager.finalizeSuite(currentSuite)
              await new Promise((resolve) =>
                setTimeout(resolve, TIMING.SUITE_COMPLETE_DELAY)
              )
            }
          }
        }

        await this.sessionCapturer.captureTrace(browser)
      } catch (err) {
        log.error(`Failed to capture trace: ${errorMessage(err)}`)
      }
    }
  }

  async after(browser?: NightwatchBrowser) {
    await this.#finalizeCurrentScreencast()
    try {
      const currentTest: any = (browser as { currentTest?: unknown })
        ?.currentTest
      const testcases = currentTest?.results?.testcases || {}

      for (const [, suite] of (
        this.suiteManager?.getAllSuites() ?? new Map()
      ).entries()) {
        this.testManager.finalizeSuiteTests(suite, testcases)
        await new Promise((resolve) =>
          setTimeout(resolve, TIMING.SUITE_COMPLETE_DELAY)
        )
        this.suiteManager.finalizeSuite(suite)
      }

      await new Promise((resolve) =>
        setTimeout(resolve, TIMING.SUITE_COMPLETE_DELAY)
      )

      const summary = [
        this.#passCount > 0 ? `${this.#passCount} passed` : null,
        this.#failCount > 0 ? `${this.#failCount} failed` : null,
        this.#skipCount > 0 ? `${this.#skipCount} skipped` : null
      ]
        .filter(Boolean)
        .join('  ')
      const totalFailed = this.#failCount

      log.info(`${totalFailed > 0 ? '❌' : '✅'} Tests complete!  ${summary}`)
      log.info(
        `   DevTools UI: http://${this.options.hostname}:${this.options.port}`
      )

      if (!this.#devtoolsBrowser) {
        // Reuse mode: force one final suites broadcast so the UI reflects the
        // actual outcome before the process exits.
        this.testReporter?.updateSuites()
        log.info('♻  Rerun complete — flushing WebSocket...')
        await this.sessionCapturer?.closeWebSocket()
        return
      }

      log.info('💡 Please close the DevTools browser window to finish...')

      if (this.#devtoolsBrowser) {
        ;(logger as { setLevel: (ns: string, lvl: string) => void }).setLevel(
          'devtools',
          'warn'
        )
        let exitBySignal = false

        const signalHandler = () => {
          exitBySignal = true
          log.info('\n✓ Exiting... Browser window will remain open')
          process.exit(0)
        }
        process.once('SIGINT', signalHandler)
        process.once('SIGTERM', signalHandler)

        while (true) {
          try {
            await this.#devtoolsBrowser.getTitle()
            await new Promise((res) =>
              setTimeout(res, TIMING.BROWSER_POLL_INTERVAL)
            )
          } catch {
            if (!exitBySignal) {
              log.info('Browser window closed, stopping DevTools app')
              break
            }
          }
        }

        if (!exitBySignal) {
          process.removeListener('SIGINT', signalHandler)
          process.removeListener('SIGTERM', signalHandler)
          ;(logger as { setLevel: (ns: string, lvl: string) => void }).setLevel(
            'devtools',
            'info'
          )
          try {
            await this.#devtoolsBrowser.deleteSession()
          } catch {
            // session already closed
          }
          await stop()
          process.exit(0)
        }
      }
    } catch (err) {
      log.error(`Failed to stop backend: ${errorMessage(err)}`)
    }
  }

  #buildMetadataOptions() {
    return {
      framework: this.#isCucumberRunner ? 'nightwatch-cucumber' : 'nightwatch',
      configFile: this.#configPath,
      baseDir: process.cwd(),
      runCapabilities: {
        canRunSuites: true,
        canRunTests: !this.#isCucumberRunner,
        canRunAll: false
      }
    }
  }

  #incrementCount(state: TestStats['state']): void {
    if (state === TEST_STATE.PASSED) {
      this.#passCount++
    } else if (state === TEST_STATE.SKIPPED) {
      this.#skipCount++
    } else {
      this.#failCount++
    }
  }

  #testIcon(state: TestStats['state']): string {
    return state === TEST_STATE.PASSED
      ? '✅'
      : state === TEST_STATE.SKIPPED
        ? '⏭'
        : '❌'
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
