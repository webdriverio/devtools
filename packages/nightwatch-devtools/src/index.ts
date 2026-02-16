/**
 * Nightwatch DevTools Plugin
 * 
 * Integrates Nightwatch with WebdriverIO DevTools following the WDIO service pattern.
 * Captures commands, network requests, and console logs during test execution in real-time.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { start, stop } from '@wdio/devtools-backend'
import logger from '@wdio/logger'
import { remote } from 'webdriverio'
import { SessionCapturer } from './session.js'
import { TestReporter } from './reporter.js'
import { TraceType, type DevToolsOptions, type NightwatchBrowser } from './types.js'
import { INTERNAL_COMMANDS_TO_IGNORE } from './constants.js'
import { findTestFileFromStack, findTestFileByName, extractTestMetadata, getCallSourceFromStack } from './utils.js'

const log = logger('@wdio/nightwatch-devtools')

class NightwatchDevToolsPlugin {
  private options: Required<DevToolsOptions>
  private sessionCapturer!: SessionCapturer
  private testReporter!: TestReporter
  private isScriptInjected = false
  #currentSuiteByFile = new Map<string, any>()
  #currentTest: any = null
  #currentTestFile: string | null = null
  #currentTestFullPath: string | null = null // Store full path from callSource
  #processedTests = new Map<string, Set<string>>() // Track which tests have been created per suite
  #browserProxied = false
  #lastSessionId: string | null = null // Track browser session changes
  #devtoolsBrowser?: WebdriverIO.Browser

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
      const server = await start(this.options)
      
      // Fastify's server doesn't have addresses() until after listen()
      // The port is already set in options after start() completes  
      const url = `http://${this.options.hostname}:${this.options.port}`
      log.info(`✓ Backend started on port ${this.options.port}`)
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
        this.#devtoolsBrowser = await remote({
          logLevel: 'silent',
          automationProtocol: 'devtools',
          capabilities: {
            browserName: 'chrome',
            'goog:chromeOptions': {
              args: ['--window-size=1600,1200']
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
      log.info('Waiting 10 seconds for UI to connect...')
      await new Promise(resolve => setTimeout(resolve, 10000))
      
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
    // Check if browser session changed (new session = new test file)
    const currentSessionId = (browser as any).sessionId
    if (currentSessionId && this.#lastSessionId && currentSessionId !== this.#lastSessionId) {
      this.#browserProxied = false
    }
    this.#lastSessionId = currentSessionId
    
    // Initialize on first test
    if (!this.sessionCapturer) {
      // Wait a bit more for WebSocket to be ready on first test
      await new Promise(resolve => setTimeout(resolve, 500))
      
      this.sessionCapturer = new SessionCapturer({
        port: this.options.port,
        hostname: this.options.hostname
      }, browser)
      
      // Wait for WebSocket to connect before proceeding
      const connected = await this.sessionCapturer.waitForConnection(3000)
      if (!connected) {
        log.error('❌ Worker WebSocket failed to connect!')
      } else {
        log.info('✓ Worker WebSocket connected')
      }
      
      // TestReporter callback sends suites data upstream in WDIO format
      this.testReporter = new TestReporter((suitesData: any) => {
        if (this.sessionCapturer) {
          // suitesData is already in WDIO format: [{ uid: {...suite} }]
          this.sessionCapturer.sendUpstream('suites', suitesData)
        }
      })
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

    // Get current test info - use WDIO DevTools approach with stack trace
    const currentTest = (browser as any).currentTest
    if (currentTest) {
      const testFile = (currentTest.module || '').split('/').pop() || currentTest.module || 'unknown'
      
      // Reset #currentTestFullPath if we're starting a new test file
      if (this.#currentTestFile !== testFile) {
        this.#currentTestFullPath = null
      }
      
      // Find test file: try stack trace first, then search workspace
      let fullPath = findTestFileFromStack() || this.#currentTestFullPath
      
      if (!fullPath && testFile) {
        // Try searching common test directories
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
        
        // Log extracted metadata for debugging
        console.log(`[METADATA] Suite: "${suiteTitle}", Tests: [${testNames.map(t => `"${t}"`).join(', ')}]`)
      }
      
      // Create/update suite for this test file
      if (!this.#currentSuiteByFile.has(testFile)) {
        const suiteStats = {
          uid: '', // Will be set by generateStableUid
          cid: '0-0',
          title: suiteTitle,
          fullTitle: suiteTitle,
          file: fullPath || testFile,
          type: 'suite' as const,
          start: new Date(),
          end: null, // Will be set when all tests complete
          tests: [] as any[],
          suites: [],
          hooks: [],
          _duration: 0
        }
        
        this.testReporter.onSuiteStart(suiteStats)
        this.#currentSuiteByFile.set(testFile, suiteStats)
        
        // Capture source file for display in Source tab
        if (fullPath && fullPath.includes('/')) {
          this.sessionCapturer.captureSource(fullPath).catch(() => {
            // Silently ignore source capture errors
          })
        }
        
        // Add all tests with pending state (like WDIO does)
        if (testNames.length > 0) {
          for (const testName of testNames) {
            const testUid = `${suiteStats.uid}::${testName}`
            const testEntry: any = {
              uid: testUid,
              cid: '0-0',
              title: testName,
              fullTitle: `${suiteTitle} ${testName}`,
              parent: suiteStats.uid,
              state: 'pending' as const,
              start: new Date(),
              end: null,
              type: 'test' as const,
              file: fullPath || testFile,
              retries: 0,
              _duration: 0,
              hooks: []
            }
            suiteStats.tests.push(testEntry)
          }
          this.testReporter.updateSuites()
        }
      }
      
      // Find which test is about to run (first unprocessed test)
      const currentSuite = this.#currentSuiteByFile.get(testFile)!
      if (!this.#processedTests.has(testFile)) {
        this.#processedTests.set(testFile, new Set())
      }
      const processedForSuite = this.#processedTests.get(testFile)!
      
      // Find first test that hasn't been processed yet and mark it as running
      let currentTestName = testNames.find(name => !processedForSuite.has(name))
      
      if (currentTestName) {
        const testIndex = currentSuite.tests.findIndex(
          (t: any) => typeof t !== 'string' && t.title === currentTestName
        )
        if (testIndex !== -1) {
          currentSuite.tests[testIndex].state = 'running'
          currentSuite.tests[testIndex].start = new Date()
          currentSuite.tests[testIndex].end = null
          // Send onTestStart for the first test
          this.testReporter.onTestStart(currentSuite.tests[testIndex])
          console.log(`[STATE] Test "${currentTestName}" → RUNNING`)
          // Small delay to let UI render the spinner before test starts executing
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }
      
      // Create temporary test for command tracking
      const uniqueTempUid = `${currentSuite.uid}::temp-${Date.now()}-${Math.random().toString(36).substring(7)}`
      
      this.#currentTest = {
        uid: uniqueTempUid,
        cid: '0-0',
        title: currentTestName || 'test',
        fullTitle: currentTestName || 'test',
        parent: currentSuite.uid,
        state: 'running' as const,
        start: new Date(),
        end: new Date(),
        type: 'test' as const,
        file: fullPath || testFile,
        retries: 0,
        _duration: 0,
        hooks: []
      }
      
      // Store reference to current suite for command tracking
      this.#currentTestFile = testFile
      
      const originalUrl = browser.url.bind(browser)
      const sessionCapturer = this.sessionCapturer
      
      browser.url = function(url: string) {
        const result = originalUrl(url) as any
        
        if (result && typeof result.perform === 'function') {
          result.perform(async function(this: any) {
            try {
              log.info(`Injecting script after navigation to: ${url}`)
              await sessionCapturer.injectScript(this)
            } catch (err) {
              log.error(`Failed to inject script: ${(err as Error).message}`)
            }
          })
        }
        
        return result
      } as any
      
      this.isScriptInjected = true
      log.info('✓ Script injection wrapped')
    }
    
    // Use Proxy to intercept ALL browser commands
    if (browser && !this.#browserProxied) {
      const self = this
      const sessionCapturer = this.sessionCapturer
      const browserAny = browser as any
      
      // Get ALL methods - both own properties and prototype
      const allMethods = new Set([
        ...Object.keys(browser),
        ...Object.getOwnPropertyNames(Object.getPrototypeOf(browser))
      ])
      const wrappedMethods: string[] = []
      
      allMethods.forEach(methodName => {
        if (methodName === 'constructor' || typeof browserAny[methodName] !== 'function') {
          return
        }
        
        // Skip internal Nightwatch commands
        if (INTERNAL_COMMANDS_TO_IGNORE.includes(methodName as any)) {
          return
        }
        
        // Skip methods starting with __ (internal methods)
        if (methodName.startsWith('__')) {
          return
        }
        
        const originalMethod = browserAny[methodName].bind(browser)
        
        browserAny[methodName] = function(...args: any[]) {
          // Get call stack using WDIO DevTools approach
          const callInfo = getCallSourceFromStack()
          const callSource = callInfo.callSource
          
          // Update #currentTestFullPath if we found a valid file
          if (callInfo.filePath && !self.#currentTestFullPath) {
            self.#currentTestFullPath = callInfo.filePath
          }
          
          try {
            // Execute the command
            const result = originalMethod(...args)
            
            // For commands that return promises, handle result when it resolves
            if (result && typeof result.then === 'function') {
              result.then(async (actualResult: any) => {
                if (!self.#currentTest || !sessionCapturer) {
                  return
                }
                
                // Extract the actual value from the resolved result
                let extractedValue: any = undefined
                if (actualResult && typeof actualResult === 'object' && 'value' in actualResult) {
                  extractedValue = actualResult.value
                } else if (actualResult !== undefined && actualResult !== result && actualResult !== browser && actualResult !== browserAny) {
                  extractedValue = actualResult
                }
                
                // Check if this command was already captured in the immediate capture path
                const lastCommand = sessionCapturer.commandsLog[sessionCapturer.commandsLog.length - 1]
                const recentlyCaptured = lastCommand && 
                  lastCommand.command === methodName && 
                  lastCommand.timestamp > Date.now() - 2000 &&
                  JSON.stringify(lastCommand.args) === JSON.stringify(args)
                
                if (recentlyCaptured) {
                  // Command was already captured, just update result if needed and it doesn't have performance data
                  const hasPerformanceData = lastCommand.result && typeof lastCommand.result === 'object' && 'resources' in lastCommand.result
                  if (extractedValue !== undefined && !hasPerformanceData && lastCommand.result === undefined) {
                    lastCommand.result = extractedValue
                    sessionCapturer.sendUpstream('commands', [lastCommand])
                  }
                } else {
                  // Command wasn't captured yet (was stored as pending), capture it now
                  const pending = (sessionCapturer as any)._pendingCommand
                  if (pending && pending.methodName === methodName) {
                    await sessionCapturer.captureCommand(
                      methodName,
                      pending.args,
                      extractedValue,
                      undefined,
                      pending.testUid,
                      pending.callSource,
                      pending.timestamp
                    ).catch(() => {})
                    delete (sessionCapturer as any)._pendingCommand
                  }
                }
              }).catch(() => {
                // Ignore promise rejection - error will be captured by original handler
              })
            }
            
            // Serialize result safely (avoid circular references and Nightwatch API objects)
            let serializedResult: any = undefined
            const isBrowserObject = result === browser || result === browserAny
            const isChainableAPI = result && typeof result === 'object' && ('queue' in result || 'sessionId' in result || 'capabilities' in result)
            
            if (isBrowserObject || isChainableAPI) {
              // For commands that return browser object, check if they should be tracked
              const isWaitCommand = methodName.startsWith('waitFor')
              // Capture waitFor commands immediately with success marker, others as undefined (will get updated by promise)
              serializedResult = isWaitCommand ? true : undefined
            } else if (result && typeof result === 'object') {
              if ('value' in result) {
                serializedResult = result.value
              } else {
                try {
                  serializedResult = JSON.parse(JSON.stringify(result))
                } catch {
                  serializedResult = String(result)
                }
              }
            } else if (result !== undefined) {
              serializedResult = result
            }
            
            // Capture command immediately if we have a result, OR if it's a special command that should be tracked
            const isSpecialCommand = ['pause', 'url', 'navigate', 'navigateTo', 'click', 'setValue'].some(cmd => 
              methodName.toLowerCase().includes(cmd.toLowerCase())
            )
            const shouldCaptureNow = serializedResult !== undefined || isSpecialCommand
            
            if (self.#currentTest && sessionCapturer) {
              if (shouldCaptureNow) {
                // Capture immediately (result may be undefined and will be updated by promise)
                sessionCapturer.captureCommand(
                  methodName,
                  args,
                  serializedResult,
                  undefined,
                  self.#currentTest.uid,
                  callSource
                ).catch((err: any) => log.error(`Failed to capture ${methodName}: ${err.message}`))
              } else {
                // Store as pending - will be captured when promise resolves
                (sessionCapturer as any)._pendingCommand = {
                  methodName,
                  args,
                  callSource,
                  timestamp: Date.now(),
                  testUid: self.#currentTest.uid
                }
              }
            }
            
            return result
          } catch (error) {
            // Capture command with error
            if (self.#currentTest && sessionCapturer) {
              sessionCapturer.captureCommand(
                methodName,
                args,
                undefined, // no result
                error instanceof Error ? error : new Error(String(error)), // ensure it's an Error object
                self.#currentTest.uid,
                callSource
              ).catch((err: any) => log.error(`Failed to capture ${methodName}: ${err.message}`))
            }
            
            throw error
          }
        }
        
        wrappedMethods.push(methodName)
      })
      
      // Keep proxy active for all tests
      if (!this.#browserProxied) {
        this.#browserProxied = true
        log.info(`✓ Wrapped ${wrappedMethods.length} browser methods`)
        log.info(`   Methods: ${wrappedMethods.slice(0, 20).join(', ')}${wrappedMethods.length > 20 ? '...' : ''}`)
      }
    }
  }

  /**
   * Nightwatch Hook: afterEach
   * Capture trace data after each test
   */
  async afterEach(browser: NightwatchBrowser) {
    if (browser && this.sessionCapturer) {
      try {
        // Update test stats with result
        if (this.#currentTest) {
          const currentTest = (browser as any).currentTest
          const results = currentTest?.results || {}
          const testFile = (currentTest.module || '').split('/').pop() || 'unknown'
          
          // Extract actual test name from results.testcases
          // BUT: results.testcases contains ALL tests in the suite, not just the current one
          // We need to find which test just finished
          const testcases = results.testcases || {}
          const testcaseNames = Object.keys(testcases)
          
          // Find the test that matches the current temp UID's commands
          // or just process the last test if we can't determine
          const currentSuite = this.#currentSuiteByFile.get(testFile)
          if (currentSuite && testcaseNames.length > 0) {
            // Get or create set of processed tests for this suite
            if (!this.#processedTests.has(testFile)) {
              this.#processedTests.set(testFile, new Set())
            }
            const processedForSuite = this.#processedTests.get(testFile)!
            
            // Process ALL unprocessed tests
            const unprocessedTests = testcaseNames.filter(name => !processedForSuite.has(name))
            
            // Process completed tests one at a time with delays
            for (const currentTestName of unprocessedTests) {
              const testcase = testcases[currentTestName]
              const testState: 'passed' | 'failed' = (testcase.passed > 0 && testcase.failed === 0) ? 'passed' : 'failed'
              const finalTestUid = `${currentSuite.uid}::${currentTestName}`
              
              // Map all commands from temp UID to final UID
              const tempUid = this.#currentTest.uid
              if (tempUid && tempUid !== finalTestUid) {
                const commandsToUpdate: any[] = []
                this.sessionCapturer.commandsLog.forEach(cmd => {
                  if (cmd.testUid === tempUid) {
                    cmd.testUid = finalTestUid
                    commandsToUpdate.push(cmd)
                  }
                })
              }
              
              // Find existing test and update it
              const testIndex = currentSuite.tests.findIndex(
                (t: any) => typeof t !== 'string' && t.title === currentTestName
              )
              
              if (testIndex !== -1) {
                // Update existing test with final state
                currentSuite.tests[testIndex].state = testState
                currentSuite.tests[testIndex].end = new Date()
                currentSuite.tests[testIndex]._duration = parseFloat(testcase.time || '0') * 1000
                currentSuite.tests[testIndex].uid = finalTestUid
                
                console.log(`[STATE] Test "${currentTestName}" → ${testState.toUpperCase()}`)
                
                // Report final state
                this.testReporter.onTestEnd(currentSuite.tests[testIndex])
              } else {
                // Test not found, add it (shouldn't happen)
                const testStats = {
                  uid: finalTestUid,
                  cid: '0-0',
                  title: currentTestName,
                  fullTitle: `${currentSuite.title} ${currentTestName}`,
                  parent: currentSuite.uid,
                  state: testState,
                  start: this.#currentTest.start,
                  end: new Date(),
                  type: 'test' as const,
                  file: currentTest.module || testFile,
                  retries: 0,
                  _duration: parseFloat(testcase.time || '0') * 1000,
                  hooks: []
                }
                currentSuite.tests.push(testStats)
              }
              
              // Mark as processed
              processedForSuite.add(currentTestName)
            }
            
            // After processing all tests, check if suite is complete
            if (processedForSuite.size === testcaseNames.length) {
              // All tests in this suite are complete
              currentSuite.end = new Date()
              currentSuite._duration = currentSuite.end.getTime() - (currentSuite.start?.getTime() || 0)
              const allPassed = currentSuite.tests.every((t: any) => t.state === 'passed')
              currentSuite.state = allPassed ? 'passed' : 'failed'
              console.log(`[STATE] Suite "${currentSuite.title}" → ${currentSuite.state.toUpperCase()} (${currentSuite.tests.length} tests)`)
              this.testReporter.onSuiteEnd(currentSuite)
              
              // Give UI time to process suite completion before next suite starts
              await new Promise(resolve => setTimeout(resolve, 200))
            } else {
              // There are more tests to run - mark next as running
              const nextTestName = testcaseNames.find(name => !processedForSuite.has(name))
              if (nextTestName) {
                const nextTestIndex = currentSuite.tests.findIndex(
                  (t: any) => typeof t !== 'string' && t.title === nextTestName
                )
                if (nextTestIndex !== -1) {
                  currentSuite.tests[nextTestIndex].state = 'running'
                  currentSuite.tests[nextTestIndex].start = new Date()
                  currentSuite.tests[nextTestIndex].end = null
                  console.log(`[STATE] Test "${nextTestName}" → RUNNING`)
                  this.testReporter.onTestStart(currentSuite.tests[nextTestIndex])
                  await new Promise(resolve => setTimeout(resolve, 100))
                }
              }
            }
          }
        }
        
        // Capture trace data from browser
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
      for (const [testFile, suite] of this.#currentSuiteByFile.entries()) {
        const processedTests = this.#processedTests.get(testFile) || new Set()
        
        // Mark any tests still in "running" state as passed (they completed successfully if we're here)
        // For pending tests, check if they actually ran by looking at Nightwatch results
        const currentTest = (browser as any)?.currentTest
        const results = currentTest?.results || {}
        const testcases = results.testcases || {}
        const actualTestNames = Object.keys(testcases)
        
        suite.tests.forEach((test: any) => {
          if (test.state === 'running' && test.start) {
            // Test was started but never finished - assume passed
            test.state = 'passed'
            test.end = new Date()
            test._duration = test.end.getTime() - (test.start?.getTime() || 0)
            console.log(`[STATE] Test "${test.title}" → PASSED (finalized)`)
            this.testReporter.onTestEnd(test)
          } else if (test.state === 'pending') {
            // Check if this test actually ran
            const testcase = testcases[test.title]
            if (testcase) {
              // Test ran but we didn't track it properly - update it now
              const testState: 'passed' | 'failed' = (testcase.passed > 0 && testcase.failed === 0) ? 'passed' : 'failed'
              test.state = testState
              test.start = test.start || new Date()
              test.end = new Date()
              test._duration = parseFloat(testcase.time || '0') * 1000
              console.log(`[STATE] Test "${test.title}" → ${testState.toUpperCase()} (from results)`)
              this.testReporter.onTestEnd(test)
            } else {
              // Test was never actually run - skip it
              test.state = 'skipped'
              test.end = new Date()
              test._duration = 0
              console.log(`[STATE] Test "${test.title}" → SKIPPED (never started)`)
              this.testReporter.onTestEnd(test)
            }
          }
        })
        
        // Give UI time to process test completions
        await new Promise(resolve => setTimeout(resolve, 200))
        
        // Now mark suite as complete
        if (!suite.end) {
          // Mark suite as complete
          suite.end = new Date()
          suite._duration = suite.end.getTime() - (suite.start?.getTime() || 0)
          const allPassed = suite.tests.every((t: any) => t.state === 'passed')
          suite.state = allPassed ? 'passed' : 'failed'
          console.log(`[STATE] Suite "${suite.title}" → ${suite.state.toUpperCase()} (${suite.tests.length} tests)`)
          this.testReporter.onSuiteEnd(suite)
        }
      }
      
      // Give UI time to process all final updates before showing completion message
      await new Promise(resolve => setTimeout(resolve, 200))
      
      log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      log.info('✅ Tests complete!')
      log.info('💡 Please close the DevTools browser window to exit')
      log.info('   Or press Ctrl+C to force exit')
      log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      
      // Keep polling until the WebSocket connection is closed
      // This indicates the browser window was closed
      await this.#waitForBrowserClose()
      
      // Close devtools browser if still open
      if (this.#devtoolsBrowser) {
        try {
          await this.#devtoolsBrowser.deleteSession()
        } catch {
          // Already closed
        }
      }
      
      log.info('🛑 Stopping DevTools backend...')
      await stop()
      log.info('✓ Backend stopped')
    } catch (err) {
      log.error(`Failed to stop backend: ${(err as Error).message}`)
    }
  }

  /**
   * Wait for browser window to close by polling browser status (WDIO method)
   */
  async #waitForBrowserClose() {
    if (!this.#devtoolsBrowser) {
      return
    }

    return new Promise<void>((resolve) => {
      // Poll browser every second to check if it's still open
      const checkInterval = setInterval(async () => {
        try {
          await this.#devtoolsBrowser!.getTitle()
          // Browser is still open, continue waiting
        } catch {
          // Browser closed
          clearInterval(checkInterval)
          log.info('✓ Browser window closed')
          resolve()
        }
      }, 1000)

      // Also handle Ctrl+C gracefully
      const sigintHandler = () => {
        clearInterval(checkInterval)
        log.info('\n✓ Received exit signal (Ctrl+C)')
        resolve()
      }
      
      process.once('SIGINT', sigintHandler)
      process.once('SIGTERM', sigintHandler)
    })
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
    // The after() hook will wait for browser window to close
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

