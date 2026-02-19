/**
 * Nightwatch DevTools Plugin
 *
 * Integrates Nightwatch with WebdriverIO DevTools following the WDIO service pattern.
 * Captures commands, network requests, and console logs during test execution in real-time.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
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
  determineTestState,
  type DevToolsOptions,
  type NightwatchBrowser,
  type TestStats
} from './types.js'
import { DEFAULTS, TIMING, TEST_STATE } from './constants.js'
import { findTestFileFromStack, findTestFileByName, extractTestMetadata } from './helpers/utils.js'

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
  #currentTestFile: string | null = null
  #lastSessionId: string | null = null
  #devtoolsBrowser?: WebdriverIO.Browser
  #userDataDir?: string

  constructor(options: DevToolsOptions = {}) {
    this.options = {
      port: options.port ?? 3000,
      hostname: options.hostname ?? 'localhost'
    }
  }

  /**
   * Nightwatch Hook: before (global)
   * Start the DevTools backend server
   */
  async before() {
    try {
      log.info('🚀 Starting DevTools backend...')
      const { server, port } = await start(this.options)

      // Update options with the actual port used (may differ if preferred port was busy)
      this.options.port = port
      const url = `http://${this.options.hostname}:${port}`
      log.info(`✓ Backend started on port ${port}`)
      log.info(``)
      log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
      log.info(`  🌐 Opening DevTools UI in browser...`)
      log.info(``)
      log.info(`     ${url}`)
      log.info(``)
      log.info(`  ⏳ Waiting for UI to connect...`)
      log.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
      log.info(``)

      // Open DevTools UI in a separate browser window using WDIO's method
      try {
        // Create unique user data directory for this instance to prevent conflicts
        this.#userDataDir = path.join(os.tmpdir(), `nightwatch-devtools-${port}-${Date.now()}`)

        // Create the directory if it doesn't exist
        if (!fs.existsSync(this.#userDataDir)) {
          fs.mkdirSync(this.#userDataDir, { recursive: true })
        }

        this.#devtoolsBrowser = await remote({
          logLevel: 'error', // Show errors if browser fails to start
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
        log.error(`Error stack: ${(err as Error).stack}`)
        log.info(`Please manually open: ${url}`)
      }

      // Wait for UI to connect
      log.info(`Waiting ${TIMING.UI_CONNECTION_WAIT / 1000} seconds for UI to connect...`)
      await new Promise(resolve => setTimeout(resolve, TIMING.UI_CONNECTION_WAIT))

      log.info('Starting tests...')


    } catch (err) {
      log.error(`Failed to start backend: ${(err as Error).message}`)
      throw err
    }
  }

  /**
   * Nightwatch Hook: beforeEach
   * Initialize session and inject script before each test
   */
  async beforeEach(browser: NightwatchBrowser) {
    const currentTest = (browser as any).currentTest
    const testFile = (currentTest?.module || '').split('/').pop() || 'unknown'
    const currentSessionId = (browser as any).sessionId

    // Check if browser session changed (happens with parallel workers)
    if (currentSessionId && this.#lastSessionId && currentSessionId !== this.#lastSessionId) {
      log.info(`Browser session changed - reinitializing for new worker`)
      this.isScriptInjected = false
      // Reset session capturer for new browser session
      this.sessionCapturer = null as any
    }
    this.#lastSessionId = currentSessionId

    // Initialize on first test OR when browser session changes
    if (!this.sessionCapturer) {
      await new Promise(resolve => setTimeout(resolve, TIMING.INITIAL_CONNECTION_WAIT))

      this.sessionCapturer = new SessionCapturer({
        port: this.options.port,
        hostname: this.options.hostname
      }, browser)

      const connected = await this.sessionCapturer.waitForConnection(3000)
      if (!connected) {
        log.error('❌ Worker WebSocket failed to connect!')
      } else {
        log.info('✓ Worker WebSocket connected')
      }

      // Initialize managers
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
        () => this.#currentTest
      )

      log.info('✓ Session initialized')

      // Send initial metadata
      const capabilities = browser.capabilities || {}
      this.sessionCapturer.sendUpstream('metadata', {
        type: TraceType.Testrunner,
        capabilities,
        options: {},
        url: ''
      })
    }

    // Get current test info and find test file
    if (currentTest) {
      const testFile = (currentTest.module || '').split('/').pop() || currentTest.module || DEFAULTS.FILE_NAME

      // Find test file: try stack trace first, then search workspace
      let fullPath: string | null = findTestFileFromStack() || null
      const cachedPath = this.browserProxy.getCurrentTestFullPath()

      // Only use cached path if it matches the current testFile
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
          path.join(workspaceRoot, testFile + '.js'),
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
        const metadata = extractTestMetadata(fullPath)
        if (metadata.suiteTitle) {
          suiteTitle = metadata.suiteTitle
        }
        testNames = metadata.testNames
      }

      // Get or create suite for this test file
      const currentSuite = this.suiteManager.getOrCreateSuite(testFile, suiteTitle, fullPath, testNames)

      // Capture source file for display
      if (fullPath && fullPath.includes('/')) {
        this.sessionCapturer.captureSource(fullPath).catch(() => {})
      }

      // Handle running test from previous beforeEach
      const runningTest = currentSuite.tests.find(
        (t: any) => typeof t !== 'string' && t.state === TEST_STATE.RUNNING
      ) as TestStats | undefined

      if (runningTest) {
        const currentTest = (browser as any).currentTest
        const testcases = currentTest?.results?.testcases || {}

        if (testcases[runningTest.title]) {
          const testcase = testcases[runningTest.title]
          const testState = determineTestState(testcase)
          runningTest.state = testState
          runningTest.end = new Date()
          runningTest._duration = parseFloat(testcase.time || '0') * 1000

          this.testManager.updateTestState(runningTest, testState)
          this.testManager.markTestAsProcessed(testFile, runningTest.title)

          await new Promise(resolve => setTimeout(resolve, TIMING.UI_RENDER_DELAY))
        } else {
          const endTime = new Date()
          const duration = endTime.getTime() - (runningTest.start?.getTime() || 0)

          this.testManager.updateTestState(runningTest, TEST_STATE.PASSED as TestStats['state'], endTime, duration)
          this.testManager.markTestAsProcessed(testFile, runningTest.title)

          await new Promise(resolve => setTimeout(resolve, TIMING.UI_RENDER_DELAY))
        }
      }

      // Find and start next test
      const processedTests = this.testManager.getProcessedTests(testFile)
      const currentTestName = testNames.find(name => !processedTests.has(name))

      if (currentTestName) {
        // Mark suite as running on first test
        if (processedTests.size === 0) {
          this.suiteManager.markSuiteAsRunning(currentSuite)
        }

        const test = this.testManager.findTestInSuite(currentSuite, currentTestName)
        if (test) {
          test.state = TEST_STATE.RUNNING as TestStats['state']
          test.start = new Date()
          test.end = null
          this.testReporter.onTestStart(test)

          // Use the real test UID for command tracking (no temporary UIDs!)
          this.#currentTest = test

          await new Promise(resolve => setTimeout(resolve, TIMING.TEST_START_DELAY))
        } else {
          // This should never happen if suite was properly initialized
          log.warn(`Test "${currentTestName}" not found in suite "${currentSuite.title}" - skipping command tracking`)
          this.#currentTest = null
        }
      }

      this.#currentTestFile = testFile

      // Wrap browser.url for script injection
      if (!this.isScriptInjected) {
        this.browserProxy.wrapUrlMethod(browser)
        this.isScriptInjected = true
      }

      // Reset command tracking
      this.browserProxy.resetCommandTracking()
    }

    // Wrap browser commands
    this.browserProxy.wrapBrowserCommands(browser)
  }

  /**
   * Nightwatch Hook: afterEach
   * Capture trace data after each test
   */
  async afterEach(browser: NightwatchBrowser) {
    if (browser && this.sessionCapturer) {
      try {
        const currentTest = (browser as any).currentTest
        const results = currentTest?.results || {}
        const testFile = (currentTest.module || '').split('/').pop() || DEFAULTS.FILE_NAME
        const testcases = results.testcases || {}
        const testcaseNames = Object.keys(testcases)

        const currentSuite = this.suiteManager.getSuite(testFile)
        if (currentSuite) {
          const processedTests = this.testManager.getProcessedTests(testFile)

          // Handle case with no results yet
          if (testcaseNames.length === 0) {
            const runningTest = currentSuite.tests.find(
              (t: any) => typeof t !== 'string' && t.state === TEST_STATE.RUNNING
            ) as TestStats | undefined

            if (runningTest && !processedTests.has(runningTest.title)) {
              const testState: TestStats['state'] = (results.errors > 0 || results.failed > 0) ?
                TEST_STATE.FAILED : TEST_STATE.PASSED
              const endTime = new Date()
              const duration = endTime.getTime() - (runningTest.start?.getTime() || 0)

              this.testManager.updateTestState(runningTest, testState, endTime, duration)
              this.testManager.markTestAsProcessed(testFile, runningTest.title)
            }
          } else {
            // Process tests with results
            const unprocessedTests = testcaseNames.filter(name => !processedTests.has(name))

            for (const currentTestName of unprocessedTests) {
              const testcase = testcases[currentTestName]
              const testState = determineTestState(testcase)

              const test = this.testManager.findTestInSuite(currentSuite, currentTestName)
              if (test) {
                this.testManager.updateTestState(test, testState, new Date(), parseFloat(testcase.time || '0') * 1000)
              }

              this.testManager.markTestAsProcessed(testFile, currentTestName)
            }

            // Check if suite is complete
            if (processedTests.size === testcaseNames.length) {
              this.suiteManager.finalizeSuite(currentSuite)
              await new Promise(resolve => setTimeout(resolve, TIMING.SUITE_COMPLETE_DELAY))
            }
          }
        }

        await this.sessionCapturer.captureTrace(browser)
      } catch (err) {
        log.error(`Failed to capture trace: ${(err as Error).message}`)
      }
    }
  }

  /**
   * Nightwatch Hook: after (global)
   * Keep the application alive until the browser window is closed
   */
  async after(browser?: NightwatchBrowser) {
    try {
      // Process any remaining incomplete suites
      const currentTest = (browser as any)?.currentTest
      const testcases = currentTest?.results?.testcases || {}

      for (const [testFile, suite] of this.suiteManager.getAllSuites().entries()) {
        this.testManager.finalizeSuiteTests(suite, testcases)
        await new Promise(resolve => setTimeout(resolve, TIMING.SUITE_COMPLETE_DELAY))
        this.suiteManager.finalizeSuite(suite)
      }

      await new Promise(resolve => setTimeout(resolve, TIMING.SUITE_COMPLETE_DELAY))

      log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      log.info('✅ Tests complete!')
      log.info('')
      log.info(`   DevTools UI: http://${this.options.hostname}:${this.options.port}`)
      log.info('')
      log.info('💡 Please close the DevTools browser window to finish...')
      log.info('   (or press Ctrl+C to exit and keep browser open)')
      log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

      // Keep the process alive by polling the devtools browser (WDIO pattern)
      // When browser closes naturally, we clean up.
      // When Ctrl+C happens, browser survives and we skip cleanup.
      if (this.#devtoolsBrowser) {
        logger.setLevel('devtools', 'warn')
        let exitBySignal = false

        // Handle Ctrl+C: exit process but let browser survive
        const signalHandler = () => {
          exitBySignal = true
          log.info('\n✓ Exiting... Browser window will remain open')
          process.exit(0)
        }
        process.once('SIGINT', signalHandler)
        process.once('SIGTERM', signalHandler)

        // Poll browser until it closes
        while (true) {
          try {
            await this.#devtoolsBrowser.getTitle()
            await new Promise((res) => setTimeout(res, TIMING.BROWSER_POLL_INTERVAL))
          } catch {
            if (!exitBySignal) {
              log.info('Browser window closed, stopping DevTools app')
              break
            }
          }
        }

        // Only clean up if browser was closed (not Ctrl+C)
        if (!exitBySignal) {
          try {
            await this.#devtoolsBrowser.deleteSession()
          } catch (err: any) {
            log.warn('Session already closed or could not be deleted:', err.message)
          }

          // Stop the backend
          log.info('🛑 Stopping DevTools backend...')
          await stop()
          log.info('✓ Backend stopped')
        }
      }
    } catch (err) {
      log.error(`Failed to stop backend: ${(err as Error).message}`)
    }
  }
}

/**
 * Factory function to create the plugin instance
 * This allows simple usage: require('@wdio/nightwatch-devtools').default
 */
export default function createNightwatchDevTools(options?: DevToolsOptions) {
  const plugin = new NightwatchDevToolsPlugin(options)

  return {
    // Set long timeout to allow user to review DevTools UI
    // The after() hook waits for the browser window to be closed
    asyncHookTimeout: 3600000, // 1 hour

    before: async function(this: any) {
      await plugin.before()
    },
    beforeEach: async function(this: any, browser: NightwatchBrowser) {
      await plugin.beforeEach(browser)
    },
    afterEach: async function(this: any, browser: NightwatchBrowser) {
      await plugin.afterEach(browser)
    },
    after: async function(this: any) {
      await plugin.after()
    }
  }
}

// Also export the class for advanced usage
export { NightwatchDevToolsPlugin }

