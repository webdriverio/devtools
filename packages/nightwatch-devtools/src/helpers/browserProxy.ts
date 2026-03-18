/**
 * Browser Proxy
 * Handles browser command interception and tracking
 */

import logger from '@wdio/logger'
import {
  INTERNAL_COMMANDS_TO_IGNORE,
  BOOLEAN_COMMAND_PATTERN,
  NAVIGATION_COMMANDS
} from '../constants.js'
import { getCallSourceFromStack } from './utils.js'
import type { SessionCapturer } from '../session.js'
import type { TestManager } from './testManager.js'
import type { NightwatchBrowser, CommandStackFrame } from '../types.js'

const log = logger('@wdio/nightwatch-devtools:browserProxy')

export class BrowserProxy {
  /** Tracks which browser *instances* have already been proxied to avoid double-wrapping. */
  private proxiedBrowsers = new WeakSet<object>()
  private commandStack: CommandStackFrame[] = []
  private lastCommandSig: string | null = null
  private currentTestFullPath: string | null = null
  /**
   * Tracks the last captured command so that consecutive retries of the same
   * command (e.g. getText inside a waitFor loop) overwrite the previous entry
   * rather than appending, showing only the final execution result.
   */
  private lastCapturedSig: string | null = null
  private lastCapturedId: number | null = null

  constructor(
    private sessionCapturer: SessionCapturer,
    private testManager: TestManager,
    private getCurrentTest: () => any
  ) {}

  /**
   * Update the session capturer reference after a WebDriver session change.
   * Does NOT re-wrap browser methods — wrapping is permanent per browser object.
   */
  updateSessionCapturer(capturer: SessionCapturer): void {
    this.sessionCapturer = capturer
  }

  /**
   * Reset command tracking for new test
   */
  resetCommandTracking(): void {
    this.commandStack = []
    this.lastCommandSig = null
    this.lastCapturedSig = null
    this.lastCapturedId = null
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
   * Wrap browser navigation methods (url / navigate / navigateTo) to inject
   * the DevTools script after every navigation.
   *
   * Uses `browser` from the closure (not `this` inside perform) so it works
   * for both standard Nightwatch (chainable API) and Cucumber async/await mode
   * where `this` inside a perform callback is not the browser.
   */
  wrapUrlMethod(browser: NightwatchBrowser): void {
    const sessionCapturer = this.sessionCapturer

    const wrapNav = (methodName: string) => {
      if (typeof (browser as any)[methodName] !== 'function') return
      const original = (browser as any)[methodName].bind(browser)

      ;(browser as any)[methodName] = function (...args: any[]) {
        const result = original(...args)

        const injectAndCapture = () =>
          sessionCapturer
            .injectScript(browser)
            .then(() => sessionCapturer.captureTrace(browser))
            .catch((err: Error) =>
              log.error(`Failed to inject script: ${err.message}`)
            )

        if (result && typeof result.perform === 'function') {
          // Standard Nightwatch (chained API): queue inside perform so it
          // runs after navigation completes.  Always pass `done` so the
          // command queue is unblocked even if injection fails.
          result.perform((done: Function) => {
            injectAndCapture().finally(() => done && done())
          })
        } else {
          // Cucumber async/await: result is a Promise (or thenable).
          Promise.resolve(result).then(injectAndCapture).catch(() => {})
        }

        return result
      }
    }

    wrapNav('url')
    wrapNav('navigate')
    wrapNav('navigateTo')

    log.info('✓ Script injection wrapped')
  }

  /**
   * Wrap all browser commands to capture them
   */
  wrapBrowserCommands(browser: NightwatchBrowser): void {
    if (this.proxiedBrowsers.has(browser as object)) {
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

    this.proxiedBrowsers.add(browser as object)
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
    browser: NightwatchBrowser,
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
                message: callbackResult.message
              }
        } else if (
          typeof callbackResult === 'object' &&
          'value' in callbackResult
        ) {
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
        const isRetry =
          cmdSig === this.lastCapturedSig && this.lastCapturedId !== null

        if (isRetry) {
          // Same command fired again (internal retry) — replace the previous
          // entry so only the final result appears in the UI.
          const { entry, oldTimestamp } = this.sessionCapturer.replaceCommand(
            this.lastCapturedId!,
            methodName,
            logArgs,
            serializedResult,
            undefined,
            effectiveUid,
            callSource,
            commandTimestamp
          )
          this.lastCapturedId = entry._id ?? null
          this.sessionCapturer.sendReplaceCommand(oldTimestamp, entry)

          // Snapshot this entry for the screenshot perform below.
          const entryToScreenshot = entry
          if (typeof (browser as any).perform === 'function') {
            const ts = (entryToScreenshot as any).timestamp
            ;(browser as any).perform((done: Function) => {
              this.sessionCapturer
                .takeScreenshotViaHttp(browser)
                .then((screenshot) => {
                  if (screenshot) {
                    ;(entryToScreenshot as any).screenshot = screenshot
                    this.sessionCapturer.sendReplaceCommand(ts, entryToScreenshot)
                  }
                  done()
                })
                .catch(() => done())
            })
          }
        } else {
          // New command — capture and track.
          // captureCommand() pushes the entry to commandsLog synchronously
          // before any async work (navigation perf capture), so we can grab
          // the ID immediately after the call — before any microtask fires.
          // This avoids the race where a Nightwatch retry callback executes
          // before .then() sets lastCapturedId, causing missed dedup.
          this.lastCapturedSig = cmdSig
          this.lastCapturedId = null
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
            .catch((err: any) =>
              log.error(`Failed to capture ${methodName}: ${err.message}`)
            )
          // Read the entry synchronously — it was already pushed above.
          const lastCommand =
            this.sessionCapturer.commandsLog[
              this.sessionCapturer.commandsLog.length - 1
            ]
          if (lastCommand) {
            this.lastCapturedId = (lastCommand as any)._id ?? null
            this.sessionCapturer.sendCommand(lastCommand)
          }

          // Queue a perform RIGHT HERE (inside captureCallback, where the entry
          // is already known) so it inserts immediately after the current command
          // — before the next test command and before end().
          // We snapshot `lastCommand` into a local const so it can never be
          // overwritten by a later captureCallback for a different command.
          const entryToScreenshot = lastCommand
          if (entryToScreenshot && typeof (browser as any).perform === 'function') {
            const ts = (entryToScreenshot as any).timestamp
            ;(browser as any).perform((done: Function) => {
              this.sessionCapturer
                .takeScreenshotViaHttp(browser)
                .then((screenshot) => {
                  if (screenshot) {
                    ;(entryToScreenshot as any).screenshot = screenshot
                    this.sessionCapturer.sendReplaceCommand(ts, entryToScreenshot)
                  }
                  done()
                })
                .catch(() => done())
            })
          }

          // After DOM-mutating commands, re-poll mutations from the injected
          // script so the browser preview stays in sync. Use setTimeout to
          // run OUTSIDE Nightwatch's current callback stack (safer queue-wise).
          const isDomMutating = (NAVIGATION_COMMANDS as readonly string[]).includes(methodName) ||
            ['click', 'doubleClick', 'rightClick', 'setValue', 'clearValue',
             'sendKeys', 'submitForm', 'back', 'forward', 'refresh'].includes(methodName)
          if (isDomMutating) {
            setTimeout(() => {
              this.sessionCapturer.captureTrace(browser).catch(() => {})
            }, 200)
          }
        }
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
   * Check if a specific browser instance is already proxied
   */
  isProxied(browser: NightwatchBrowser): boolean {
    return this.proxiedBrowsers.has(browser as object)
  }
}
