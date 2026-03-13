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
import logger from '@wdio/logger'
import { remote } from 'webdriverio'
import { SessionCapturer } from './session.js'
import { TestReporter } from './reporter.js'
import { TestManager } from './helpers/testManager.js'
import { SuiteManager } from './helpers/suiteManager.js'
import { BrowserProxy } from './helpers/browserProxy.js'
import {
  TraceType,
  type DevToolsOptions,
  type NightwatchBrowser,
  type TestStats
} from './types.js'
import {
  determineTestState,
  findTestFileFromStack,
  deterministicUid,
  extractTestMetadata,
  parseStepKeywords
} from './helpers/utils.js'
import { DEFAULTS, TIMING, TEST_STATE } from './constants.js'

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

  constructor(options: DevToolsOptions = {}) {
    this.options = {
      port: options.port ?? 3000,
      hostname: options.hostname ?? 'localhost'
    }
  }

  async before() {
    try {
      log.info('🚀 Starting DevTools backend...')
      await start(this.options)
      const url = `http://${this.options.hostname}:${this.options.port}`
      log.info(`✓ Backend started on port ${this.options.port}`)
      log.info('')
      log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      log.info('  🌐 Opening DevTools UI in browser...')
      log.info('')
      log.info(`     ${url}`)
      log.info('')
      log.info('  ⏳ Waiting for UI to connect...')
      log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      log.info('')

      try {
        // Create unique user data directory for this instance to prevent conflicts
        this.#userDataDir = path.join(
          os.tmpdir(),
          `nightwatch-devtools-${this.options.port}-${Date.now()}`
        )

        // Create the directory if it doesn't exist
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
        log.info('✓ DevTools UI opened in separate browser window')
      } catch (err) {
        log.error(`Failed to open DevTools UI: ${(err as Error).message}`)
        log.info(`Please manually open: ${url}`)
      }

      // Wait for UI to connect
      log.info(
        `Waiting ${TIMING.UI_CONNECTION_WAIT / 1000} seconds for UI to connect...`
      )
      await new Promise((resolve) =>
        setTimeout(resolve, TIMING.UI_CONNECTION_WAIT)
      )

      log.info('Starting tests...')
      // Expose this plugin instance so cucumberHooks.cjs can call back into it
      ;(globalThis as any).__nightwatchDevtoolsPlugin = this
    } catch (err) {
      log.error(`Failed to start backend: ${(err as Error).message}`)
      throw err
    }
  }

  async #ensureSessionInitialized(browser: NightwatchBrowser) {
    const currentSessionId = (browser as any).sessionId
    const isSessionChange =
      currentSessionId &&
      this.#lastSessionId &&
      currentSessionId !== this.#lastSessionId

    if (isSessionChange) {
      log.info('Browser session changed — reconnecting WebSocket only')
      this.isScriptInjected = false
      this.sessionCapturer?.cleanup()
      this.sessionCapturer = null as any
    }
    this.#lastSessionId = currentSessionId

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
    } else {
      log.info('✓ Worker WebSocket connected')
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

    log.info('✓ Session initialized')

    const capabilities = (browser as any).capabilities || {}
    const desiredCapabilities = (browser as any).desiredCapabilities || {}
    const sessionId = (browser as any).sessionId
    const opts = (browser as any).options || {}
    this.sessionCapturer.sendUpstream('metadata', {
      type: TraceType.Testrunner,
      capabilities,
      desiredCapabilities,
      sessionId,
      testEnv: opts.testEnv,
      host: opts.webdriver?.host,
      options: {},
      url: ''
    })

    const browserName =
      capabilities.browserName || desiredCapabilities.browserName || 'unknown'
    const browserVersion =
      capabilities.browserVersion || (capabilities as any).version || ''
    log.info(
      `✓ Browser: ${browserName}${browserVersion ? ' ' + browserVersion : ''} (session: ${sessionId})`
    )

    const loggingPrefs =
      (capabilities as any)['goog:loggingPrefs'] ||
      (desiredCapabilities as any)['goog:loggingPrefs'] ||
      {}
    if (!loggingPrefs.performance) {
      log.warn(
        "⚠  Network tab will be empty — add 'goog:loggingPrefs': { performance: 'ALL' } to your capabilities"
      )
    }
  }

  async cucumberBefore(browser: NightwatchBrowser, pickle: any) {
    // Eagerly mark as Cucumber so beforeEach (which checks this flag) does not
    // also run the non-Cucumber initialisation path for the same scenario.
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

    // Derive the feature name from the "Feature: <name>" header in the file,
    // falling back to the filename (e.g. "login") only if the file can't be read.
    let featureName: string = path.basename(featureUri, '.feature')
    let featureContent = ''
    const featureAbsPath = path.resolve(process.cwd(), featureUri)
    if (featureUri !== 'unknown.feature' && fs.existsSync(featureAbsPath)) {
      featureContent = fs.readFileSync(featureAbsPath, 'utf-8')
      const match = featureContent.match(/^\s*Feature:\s*(.+)/m)
      if (match) {
        featureName = match[1].trim()
      }

      this.sessionCapturer.captureSource(featureAbsPath).catch(() => {})

      // Capture step definitions from sibling directories
      const featureDir = path.dirname(featureAbsPath)
      const stepDirCandidates = ['step_definitions', 'steps', 'support']
      for (const candidate of stepDirCandidates) {
        const stepDir = path.join(featureDir, candidate)
        if (fs.existsSync(stepDir) && fs.statSync(stepDir).isDirectory()) {
          for (const entry of fs.readdirSync(stepDir)) {
            if (/\.(js|ts|mjs|cjs)$/.test(entry)) {
              this.sessionCapturer
                .captureSource(path.join(stepDir, entry))
                .catch(() => {})
            }
          }
        }
      }
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
    const stepKeywords = parseStepKeywords(
      featureContent,
      scenarioName,
      steps.length
    )

    // Create a scenario sub-suite (child of feature suite).
    // Use deterministicUid (no counter) so the SAME scenario always maps to the
    // SAME uid across retries, enabling correct retry detection below.
    const scenarioUid = deterministicUid(featureUri, `scenario:${scenarioName}`)

    const scenarioSuite: any = {
      uid: scenarioUid,
      cid: DEFAULTS.CID,
      title: scenarioName,
      fullTitle: `${featureName} ${scenarioName}`,
      parent: featureSuite.uid,
      type: 'suite' as const,
      file: featureUri,
      start: new Date(),
      state: 'running',
      end: null,
      tests: [],
      suites: [],
      hooks: [],
      _duration: 0
    }

    // Create a TestStats entry for each step
    steps.forEach((step, i) => {
      const keyword = stepKeywords[i] || ''
      const stepLabel = keyword ? `${keyword} ${step.text}` : step.text
      const stepUid = deterministicUid(
        featureUri,
        `step:${scenarioName}:${step.text}`
      )
      scenarioSuite.tests.push({
        uid: stepUid,
        cid: DEFAULTS.CID,
        title: stepLabel,
        fullTitle: `${scenarioName} ${stepLabel}`,
        parent: scenarioUid,
        state: 'pending',
        start: new Date(),
        end: null,
        type: 'test' as const,
        file: featureUri,
        retries: 0,
        _duration: 0,
        hooks: []
      })
    })

    // Add scenario sub-suite to the feature suite.
    // If a suite with this uid already exists it means this is a RETRY of the same
    // scenario — clear execution data so only the latest attempt's commands are shown.
    const existingIdx = featureSuite.suites.findIndex(
      (s: any) => s.uid === scenarioUid
    )
    const isRetry = existingIdx !== -1
    if (isRetry) {
      featureSuite.suites[existingIdx] = scenarioSuite
      // Clear all captured commands/console/network from the previous failed attempt.
      this.sessionCapturer.sendUpstream('clearExecutionData', {})
    } else {
      featureSuite.suites.push(scenarioSuite)
      // First execution of this scenario — commands accumulate alongside previous
      // scenarios in the run (same as WDIO devtools behaviour).
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
      const status = String(result?.status ?? 'UNKNOWN').toUpperCase()
      const scenarioState: TestStats['state'] =
        status === 'PASSED'
          ? TEST_STATE.PASSED
          : status === 'SKIPPED'
            ? TEST_STATE.SKIPPED
            : TEST_STATE.FAILED

      if (this.#currentScenarioSuite) {
        const duration =
          Date.now() -
          (this.#currentScenarioSuite.start?.getTime() ?? Date.now())
        this.#currentScenarioSuite.state = scenarioState
        this.#currentScenarioSuite.end = new Date()
        this.#currentScenarioSuite._duration = duration

        // Ensure any still-running or pending steps are marked appropriately
        for (const step of this.#currentScenarioSuite.tests) {
          if (
            typeof step !== 'string' &&
            (step.state === 'running' || step.state === 'pending')
          ) {
            step.state =
              scenarioState === TEST_STATE.PASSED
                ? TEST_STATE.PASSED
                : TEST_STATE.FAILED
            step.end = new Date()
          }
        }

        const featureUri: string = pickle?.uri ?? 'unknown.feature'
        this.testManager.markTestAsProcessed(featureUri, pickle?.name ?? '')

        const featureSuite = this.suiteManager.getSuite(featureUri)
        if (featureSuite) {
          // Finalize is not called until all scenarios are done — just update state
          this.suiteManager.finalizeSuiteState(featureSuite)
        }

        this.#incrementCount(scenarioState)
        const icon = this.#testIcon(scenarioState)
        const durationSec = (duration / 1000).toFixed(2)
        log.info(`  ${icon} ${pickle?.name ?? 'Unknown'} (${durationSec}s)`)

        this.testReporter.updateSuites()
        this.#currentScenarioSuite = null
        this.#currentStep = null
        this.#currentTest = null
      }

      await this.sessionCapturer.captureTrace(browser)
    } catch (err) {
      log.error(
        `Failed to finalize Cucumber scenario: ${(err as Error).message}`
      )
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
    const step = (this.#currentScenarioSuite.tests as any[]).find(
      (t: any) =>
        typeof t !== 'string' &&
        (t.title.endsWith(stepText) || t.title === stepText)
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

    const currentTest = (browser as any).currentTest
    if (!currentTest) {
      return
    }

    const testFile =
      (currentTest.module || '').split('/').pop() ||
      currentTest.module ||
      DEFAULTS.FILE_NAME

    let fullPath: string | null = findTestFileFromStack() || null
    const cachedPath = this.browserProxy.getCurrentTestFullPath()
    if (!fullPath && cachedPath && cachedPath.includes(testFile)) {
      fullPath = cachedPath
    }

    if (!fullPath && testFile) {
      const workspaceRoot = process.cwd()
      const possiblePaths = [
        path.join(workspaceRoot, 'example/tests', testFile + '.js'),
        path.join(workspaceRoot, 'example/tests', testFile),
        path.join(workspaceRoot, 'tests', testFile + '.js'),
        path.join(workspaceRoot, 'test', testFile + '.js'),
        path.join(workspaceRoot, testFile + '.js')
      ]

      for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
          fullPath = possiblePath
          break
        }
      }
    }

    // Extract suite title and test metadata
    let suiteTitle = testFile
    let testNames: string[] = []
    if (fullPath) {
      const { suiteTitle: parsedTitle, testNames: parsedNames } =
        extractTestMetadata(fullPath)
      if (parsedTitle) {
        suiteTitle = parsedTitle
      }
      testNames = parsedNames
    }

    // Get or create suite for this test file
    const currentSuite = this.suiteManager.getOrCreateSuite(
      testFile,
      suiteTitle,
      fullPath,
      testNames
    )

    // Capture source file for display
    if (fullPath && fullPath.includes('/')) {
      this.sessionCapturer.captureSource(fullPath).catch(() => {})
    }

    const runningTest = currentSuite.tests.find(
      (t: any) => typeof t !== 'string' && t.state === TEST_STATE.RUNNING
    ) as TestStats | undefined

    if (runningTest) {
      const testcases = currentTest?.results?.testcases || {}

      if (testcases[runningTest.title]) {
        const testcase = testcases[runningTest.title]
        const testState = determineTestState(testcase)
        runningTest.state = testState
        runningTest.end = new Date()
        runningTest._duration = parseFloat(testcase.time || '0') * 1000
        this.testManager.updateTestState(runningTest, testState)
        this.testManager.markTestAsProcessed(testFile, runningTest.title)
        this.#incrementCount(testState)
        const prevIcon = this.#testIcon(testState)
        log.info(
          `  ${prevIcon} ${runningTest.title} (${(runningTest._duration / 1000).toFixed(2)}s)`
        )
      } else {
        const endTime = new Date()
        const duration = endTime.getTime() - (runningTest.start?.getTime() || 0)
        this.testManager.updateTestState(
          runningTest,
          TEST_STATE.PASSED as TestStats['state'],
          endTime,
          duration
        )
        this.testManager.markTestAsProcessed(testFile, runningTest.title)
        this.#passCount++
        log.info(`  ✅ ${runningTest.title} (${(duration / 1000).toFixed(2)}s)`)
      }
      await new Promise((resolve) =>
        setTimeout(resolve, TIMING.UI_RENDER_DELAY)
      )
    }

    const processedTests = this.testManager.getProcessedTests(testFile)
    const currentTestName = testNames.find((name) => !processedTests.has(name))

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
        const currentTest = (browser as any).currentTest
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
        log.error(`Failed to capture trace: ${(err as Error).message}`)
      }
    }
  }

  async after(browser?: NightwatchBrowser) {
    try {
      const currentTest = (browser as any)?.currentTest
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

      log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      log.info(`${totalFailed > 0 ? '❌' : '✅'} Tests complete!  ${summary}`)
      log.info('')
      log.info(
        `   DevTools UI: http://${this.options.hostname}:${this.options.port}`
      )
      log.info('')
      log.info('💡 Please close the DevTools browser window to finish...')
      log.info('   (or press Ctrl+C to exit and keep browser open)')
      log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

      if (this.#devtoolsBrowser) {
        ;(logger as any).setLevel('devtools', 'warn')
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
          ;(logger as any).setLevel('devtools', 'info')
          try {
            await this.#devtoolsBrowser.deleteSession()
          } catch (err: any) {
            log.warn(
              'Session already closed or could not be deleted:',
              err.message
            )
          }

          log.info('🛑 Stopping DevTools backend...')
          await stop()
          log.info('✓ Backend stopped')
        }
      }
    } catch (err) {
      log.error(`Failed to stop backend: ${(err as Error).message}`)
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

    eventHub.on('TestSuiteStarted', (data: any) => {
      try {
        const { sessionCapabilities, sessionId, testEnv, host, modulePath } =
          data?.metadata ?? {}

        if (this.sessionCapturer && (sessionCapabilities || sessionId)) {
          log.info(`TestSuiteStarted: env=${testEnv}, session=${sessionId}`)
          this.sessionCapturer.sendUpstream('metadata', {
            type: TraceType.Testrunner,
            capabilities: sessionCapabilities ?? {},
            sessionId,
            testEnv,
            host,
            modulePath,
            options: {}
          })
        }
      } catch (err) {
        log.error(
          `Error in TestSuiteStarted handler: ${(err as Error).message}`
        )
      }
    })

    eventHub.on('TestRunStarted', (data: any) => {
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
            options: {}
          })
        }
      } catch (err) {
        log.error(`Error in TestRunStarted handler: ${(err as Error).message}`)
      }
    })

    eventHub.on('ScreenshotCreated', (data: any) => {
      try {
        log.info(`Screenshot created: ${data?.path ?? 'unknown path'}`)
      } catch {
        // ignore
      }
    })
  }
}

/**
 * The absolute path to the compiled Cucumber hooks file.
 * Kept for backwards compatibility — prefer using `withCucumber()` instead.
 */
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
