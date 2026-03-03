/**
 * Browser Proxy
 * Handles browser command interception and tracking
 */

import logger from '@wdio/logger'
import { INTERNAL_COMMANDS_TO_IGNORE, BOOLEAN_COMMAND_PATTERN } from '../constants.js'
import { getCallSourceFromStack } from './utils.js'
import type { SessionCapturer } from '../session.js'
import type { TestManager } from './testManager.js'
import type { NightwatchBrowser, CommandStackFrame } from '../types.js'

const log = logger('@wdio/nightwatch-devtools:browserProxy')

export class BrowserProxy {
  private browserProxied = false
  private commandStack: CommandStackFrame[] = []
  private lastCommandSig: string | null = null
  private currentTestFullPath: string | null = null

  constructor(
    private sessionCapturer: SessionCapturer,
    private testManager: TestManager,
    private getCurrentTest: () => any
  ) {}

  /**
   * Reset command tracking for new test
   */
  resetCommandTracking(): void {
    this.commandStack = []
    this.lastCommandSig = null
  }

  /**
   * Get current test file path
   */
  getCurrentTestFullPath(): string | null {
    return this.currentTestFullPath
  }

  /**
   * Set current test file path
   */
  setCurrentTestFullPath(path: string | null): void {
    this.currentTestFullPath = path
  }

  /**
   * Wrap browser.url to inject the DevTools script after every navigation.
   *
   * NOTE: This wraps the raw `browser.url` before `wrapBrowserCommands` runs.
   * When `wrapBrowserCommands` subsequently wraps this function it will inject
   * our result-capturing callback as the last argument.  We must forward *all*
   * arguments (including that callback) through to the real `originalUrl` so
   * that Nightwatch's command queue fires it and we receive the actual result.
   */
  wrapUrlMethod(browser: NightwatchBrowser): void {
    const originalUrl = browser.url.bind(browser)
    const sessionCapturer = this.sessionCapturer

    browser.url = function (...urlArgs: any[]) {
      const result = (originalUrl as any)(...urlArgs) as any

      if (result && typeof result.perform === 'function') {
        result.perform(async function (this: any) {
          try {
            await sessionCapturer.injectScript(this)
          } catch (err) {
            log.error(`Failed to inject script: ${(err as Error).message}`)
          }
        })
      }

      return result
    } as any

    log.info('✓ Script injection wrapped')
  }

  /**
   * Wrap all browser commands to capture them
   */
  wrapBrowserCommands(browser: NightwatchBrowser): void {
    if (this.browserProxied) {
      return
    }

    const browserAny = browser as any
    const allMethods = new Set([
      ...Object.keys(browser),
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(browser))
    ])
    const wrappedMethods: string[] = []

    allMethods.forEach((methodName) => {
      if (
        methodName === 'constructor' ||
        typeof browserAny[methodName] !== 'function'
      ) {
        return
      }

      if (
        INTERNAL_COMMANDS_TO_IGNORE.includes(methodName as any) ||
        methodName.startsWith('__')
      ) {
        return
      }

      const originalMethod = browserAny[methodName].bind(browser)

      browserAny[methodName] = (...args: any[]) => {
        return this.handleCommandExecution(
          browser,
          browserAny,
          methodName,
          originalMethod,
          args
        )
      }

      wrappedMethods.push(methodName)
    })

    this.browserProxied = true
    log.info(`✓ Wrapped ${wrappedMethods.length} browser methods`)
  }

  /**
   * Handle command execution with tracking.
   *
   * Injects a result-capturing callback as the last argument so that the actual
   * WebDriver result value (from Nightwatch's command queue) is available when
   * the command finishes rather than being `undefined`.
   */
  private handleCommandExecution(
    _browser: NightwatchBrowser,
    browserAny: any,
    methodName: string,
    originalMethod: Function,
    args: any[]
  ): any {
    // Detect test boundaries
    const currentNightwatchTest = browserAny.currentTest
    const currentTestName = this.testManager.detectTestBoundary(
      currentNightwatchTest
    )

    // Start test if this is its first command
    this.testManager.startTestIfPending(currentTestName)

    // Get call source
    const callInfo = getCallSourceFromStack()
    if (callInfo.filePath && !this.currentTestFullPath) {
      this.currentTestFullPath = callInfo.filePath
    }

    // Separate any user-supplied callback from the positional args so we can
    // inject our own result-capturing wrapper without losing the user's cb.
    const lastArg = args[args.length - 1]
    const hasUserCallback = typeof lastArg === 'function'
    const userCallback: Function | null = hasUserCallback ? lastArg : null
    // The "logical" args that we will log (without callback)
    const logArgs = hasUserCallback ? args.slice(0, -1) : args

    // Check for duplicate commands (based on method + logical args)
    const cmdSig = JSON.stringify({
      command: methodName,
      args: logArgs,
      src: callInfo.callSource
    })
    const isDuplicate = this.lastCommandSig === cmdSig

    if (!isDuplicate) {
      this.commandStack.push({
        command: methodName,
        callSource: callInfo.callSource,
        signature: cmdSig
      })
      this.lastCommandSig = cmdSig
    }

    // Snapshot test context at call time (may change by callback time)
    const testAtCallTime = this.getCurrentTest()
    const testUid = testAtCallTime?.uid
    const callSource = callInfo.callSource
    const commandTimestamp = Date.now()

    /**
     * Result-capturing callback — called by Nightwatch's async queue when the
     * command completes.  This is where we get the *actual* result value.
     */
    const captureCallback = (callbackResult: any) => {
      // Pop stack frame (if not already done for duplicates)
      const stackFrame = this.commandStack[this.commandStack.length - 1]
      if (
        stackFrame?.command === methodName &&
        stackFrame.signature === cmdSig
      ) {
        this.commandStack.pop()
      }

      // ── Step 1: extract / normalise the result ───────────────────────────
      // All Nightwatch commands return {value: V, status: 0} to the callback.
      //
      // Commands that semantically return a boolean (waitFor*, is*, has*,
      // anything ending in Visible/Present/Enabled/Selected/NotVisible/
      // NotPresent) return {value: true} on success and {value: null} on
      // failure/timeout.  Detected generically via BOOLEAN_COMMAND_PATTERN
      // (defined in constants.ts) — no hardcoded list needed.
      const isBooleanCommand = BOOLEAN_COMMAND_PATTERN.test(methodName)

      let serializedResult: any = undefined
      if (callbackResult !== null && callbackResult !== undefined) {
        if (typeof callbackResult === 'object' && 'passed' in callbackResult) {
          // Nightwatch assertion object {passed, actual, expected, message}
          serializedResult = callbackResult.passed
            ? true
            : {
                passed: false,
                actual: callbackResult.actual,
                expected: callbackResult.expected,
                message: callbackResult.message,
              }
        } else if (typeof callbackResult === 'object' && 'value' in callbackResult) {
          const raw = callbackResult.value
          // Boolean-semantic command returning null → timed out / not found → false
          serializedResult = raw === null && isBooleanCommand ? false : raw
        } else if (typeof callbackResult !== 'function') {
          try {
            serializedResult = JSON.parse(JSON.stringify(callbackResult))
          } catch {
            serializedResult = String(callbackResult)
          }
        }
      }

      // ── Step 2: capture & send ───────────────────────────────────────────
      // Use the test context that is current *now* (at completion time), but
      // fall back to the snapshot taken at call time.
      const currentTest = this.getCurrentTest()
      const effectiveUid = currentTest?.uid ?? testUid

      if (effectiveUid) {
        this.sessionCapturer
          .captureCommand(
            methodName,
            logArgs,
            serializedResult,
            undefined,
            effectiveUid,
            callSource,
            commandTimestamp
          )
          .then(() => {
            const lastCommand =
              this.sessionCapturer.commandsLog[
                this.sessionCapturer.commandsLog.length - 1
              ]
            if (lastCommand) {
              this.sessionCapturer.sendCommand(lastCommand)
            }
          })
          .catch((err: any) =>
            log.error(`Failed to capture ${methodName}: ${err.message}`)
          )
      }

      // Forward to the user's original callback (if any)
      if (userCallback) {
        return userCallback(callbackResult)
      }
    }

    // Build modified args: logical args + our capturing callback
    const modifiedArgs = [...logArgs, captureCallback]

    try {
      const result = originalMethod(...modifiedArgs)
      return result
    } catch (error) {
      // Handle synchronous queue-level errors (rare)
      const stackFrame = this.commandStack[this.commandStack.length - 1]
      if (
        stackFrame?.command === methodName &&
        stackFrame.signature === cmdSig
      ) {
        this.commandStack.pop()
      }
      this.captureCommandError(methodName, logArgs, error, callSource)
      throw error
    }
  }

  /**
   * Capture command error
   */
  private captureCommandError(
    methodName: string,
    args: any[],
    error: any,
    callSource: string | undefined
  ): void {
    const currentTest = this.getCurrentTest()
    if (!currentTest) {
      return
    }

    this.sessionCapturer
      .captureCommand(
        methodName,
        args,
        undefined,
        error instanceof Error ? error : new Error(String(error)),
        currentTest.uid,
        callSource
      )
      .catch((err: any) =>
        log.error(`Failed to capture ${methodName}: ${err.message}`)
      )

    const lastCommand =
      this.sessionCapturer.commandsLog[
        this.sessionCapturer.commandsLog.length - 1
      ]
    if (lastCommand) {
      this.sessionCapturer.sendCommand(lastCommand)
    }
  }

  /**
   * Check if browser is already proxied
   */
  isProxied(): boolean {
    return this.browserProxied
  }
}
