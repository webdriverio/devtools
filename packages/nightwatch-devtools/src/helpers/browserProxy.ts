/**
 * Browser Proxy
 * Handles browser command interception and tracking
 */

import logger from '@wdio/logger'
import {
  INTERNAL_COMMANDS_TO_IGNORE,
  NAVIGATION_COMMANDS
} from '../constants.js'
import { getCallSourceFromStack } from './utils.js'
import { serializeCommandResult } from './serializeCommandResult.js'
import { RetryTracker, toError } from '@wdio/devtools-core'
import type { SessionCapturer } from '../session.js'
import type { TestManager } from './testManager.js'
import type {
  CommandLog,
  NightwatchBrowser,
  NightwatchCurrentTest,
  CommandStackFrame
} from '../types.js'

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
  private retryTracker = new RetryTracker()

  constructor(
    private sessionCapturer: SessionCapturer,
    private testManager: TestManager,
    private getCurrentTest: () => { uid?: string } | null
  ) {}

  /**
   * Update the session capturer reference after a WebDriver session change.
   * Does NOT re-wrap browser methods — wrapping is permanent per browser object.
   */
  updateSessionCapturer(capturer: SessionCapturer): void {
    this.sessionCapturer = capturer
  }

  resetCommandTracking(): void {
    this.commandStack = []
    this.lastCommandSig = null
    this.retryTracker.reset()
  }

  getCurrentTestFullPath(): string | null {
    return this.currentTestFullPath
  }

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

    // Cast once for dynamic method access — Nightwatch's typed surface
    // doesn't enumerate every command, but they all live on the same object.
    // Return type is `unknown` because wrapNav has to handle both
    // Nightwatch's chainable API (returns a chainable with `.perform`) and
    // Cucumber async/await (returns a Promise) — we narrow at each branch.
    const b = browser as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >

    const wrapNav = (methodName: string) => {
      if (typeof b[methodName] !== 'function') {
        return
      }
      const original = b[methodName].bind(browser)

      b[methodName] = function (...args: unknown[]) {
        const result = original(...args)

        const injectAndCapture = () => {
          log.info(`[nav] ${methodName}(${args[0] ?? ''}) — injecting script`)
          return sessionCapturer
            .injectScript(browser)
            .then(() => sessionCapturer.captureTrace(browser))
            .catch((err: Error) =>
              log.error(`Failed to inject script: ${(err as Error).message}`)
            )
        }

        const chainable = result as
          | { perform?: (cb: (done: Function) => void) => void }
          | undefined
        if (chainable && typeof chainable.perform === 'function') {
          // Standard Nightwatch (chained API): queue inside perform so it
          // runs after navigation completes.  Always pass `done` so the
          // command queue is unblocked even if injection fails.
          chainable.perform((done: Function) => {
            injectAndCapture().finally(() => done && done())
          })
          return result
        }
        // Cucumber async/await: result is a Promise (or thenable).
        // Return the AUGMENTED promise so that `await browser.url(...)` in
        // the step definition waits for injectAndCapture to finish before
        // Cucumber moves to the next step. Without this the injection races
        // with the next step's commands (e.g. setValue), causing stale-element
        // errors because the script-tag insertion mutates the DOM mid-form.
        return Promise.resolve(result)
          .then(injectAndCapture)
          .catch(() => {})
      }
    }

    wrapNav('url')
    wrapNav('navigate')
    wrapNav('navigateTo')

    log.info('✓ Script injection wrapped')
  }

  wrapBrowserCommands(browser: NightwatchBrowser): void {
    if (this.proxiedBrowsers.has(browser as object)) {
      return
    }

    // Single widening: Nightwatch's `browser` is a dynamic command bag —
    // every wrapped lookup below is property-name → function. Casting once
    // keeps the wrap loop readable.
    const browserAny = browser as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >
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
        (INTERNAL_COMMANDS_TO_IGNORE as readonly string[]).includes(
          methodName
        ) ||
        methodName.startsWith('__')
      ) {
        return
      }

      const originalMethod = browserAny[methodName].bind(browser)

      browserAny[methodName] = (...args: unknown[]) => {
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

  private handleRetryReplacement(
    browser: NightwatchBrowser,
    methodName: string,
    logArgs: unknown[],
    serializedResult: unknown,
    effectiveUid: string,
    callSource: string | undefined,
    commandTimestamp: number
  ): void {
    // Same command fired again (internal retry) — replace the previous
    // entry so only the final result appears in the UI.
    const { entry, oldTimestamp } = this.sessionCapturer.replaceCommand(
      this.retryTracker.lastId!,
      methodName,
      logArgs,
      serializedResult,
      undefined,
      effectiveUid,
      callSource,
      commandTimestamp
    )
    this.retryTracker.setLastId(entry._id ?? null)
    this.sessionCapturer.sendReplaceCommand(oldTimestamp, entry)
    this.attachScreenshot(browser, entry, methodName, ' (retry)')
  }

  private captureFreshCommand(
    browser: NightwatchBrowser,
    methodName: string,
    logArgs: unknown[],
    serializedResult: unknown,
    effectiveUid: string,
    callSource: string | undefined,
    commandTimestamp: number,
    cmdSig: string
  ): void {
    // captureCommand() pushes the entry to commandsLog synchronously before
    // any async work (navigation perf capture), so we can grab the ID
    // immediately after the call — before any microtask fires. This avoids
    // the race where a Nightwatch retry callback executes before .then() sets
    // lastId, causing missed dedup. Stage the sig now, set the id after the
    // synchronous push lands.
    this.retryTracker.setLastSig(cmdSig)
    this.retryTracker.setLastId(null)
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
      .catch((err) =>
        log.error(`Failed to capture ${methodName}: ${(err as Error).message}`)
      )
    const lastCommand =
      this.sessionCapturer.commandsLog[
        this.sessionCapturer.commandsLog.length - 1
      ]
    if (lastCommand) {
      this.retryTracker.setLastId((lastCommand as { _id?: number })._id ?? null)
      this.sessionCapturer.sendCommand(lastCommand)
      log.info(`[command] ${methodName}`)
      this.attachScreenshot(browser, lastCommand, methodName)
    }
    this.maybeRepollMutations(browser, methodName)
  }

  // After DOM-mutating commands, re-poll mutations from the injected script
  // so the browser preview stays in sync. setTimeout runs OUTSIDE Nightwatch's
  // current callback stack (safer queue-wise).
  private maybeRepollMutations(
    browser: NightwatchBrowser,
    methodName: string
  ): void {
    const isDomMutating =
      (NAVIGATION_COMMANDS as readonly string[]).includes(methodName) ||
      [
        'click',
        'doubleClick',
        'rightClick',
        'setValue',
        'clearValue',
        'sendKeys',
        'submitForm',
        'back',
        'forward',
        'refresh'
      ].includes(methodName)
    if (!isDomMutating) {
      return
    }
    setTimeout(() => {
      this.sessionCapturer.captureTrace(browser).catch(() => {})
    }, 200)
  }

  private popCommandStackIfMatches(methodName: string, cmdSig: string): void {
    const stackFrame = this.commandStack[this.commandStack.length - 1]
    if (stackFrame?.command === methodName && stackFrame.signature === cmdSig) {
      this.commandStack.pop()
    }
  }

  // Result-capturing callback factory — called by Nightwatch's async queue
  // when the command completes. This is where we get the *actual* result.
  private makeCaptureCallback(
    browser: NightwatchBrowser,
    methodName: string,
    logArgs: unknown[],
    cmdSig: string,
    callSource: string | undefined,
    commandTimestamp: number,
    testUid: string | undefined,
    userCallback: Function | null
  ): (callbackResult: unknown) => unknown {
    return (callbackResult: unknown) => {
      this.popCommandStackIfMatches(methodName, cmdSig)
      const serializedResult = serializeCommandResult(
        callbackResult,
        methodName
      )
      const effectiveUid = this.getCurrentTest()?.uid ?? testUid
      if (effectiveUid) {
        if (this.retryTracker.isRetry(cmdSig)) {
          this.handleRetryReplacement(
            browser,
            methodName,
            logArgs,
            serializedResult,
            effectiveUid,
            callSource,
            commandTimestamp
          )
        } else {
          this.captureFreshCommand(
            browser,
            methodName,
            logArgs,
            serializedResult,
            effectiveUid,
            callSource,
            commandTimestamp,
            cmdSig
          )
        }
      }
      if (userCallback) {
        return userCallback(callbackResult)
      }
    }
  }

  private pushCommandStackIfNew(
    methodName: string,
    cmdSig: string,
    callSource: string | undefined
  ): void {
    if (this.lastCommandSig === cmdSig) {
      return
    }
    this.commandStack.push({
      command: methodName,
      callSource,
      signature: cmdSig
    })
    this.lastCommandSig = cmdSig
  }

  private handleCommandExecution(
    browser: NightwatchBrowser,
    browserAny: Record<string, unknown>,
    methodName: string,
    originalMethod: Function,
    args: unknown[]
  ): unknown {
    this.testManager.startTestIfPending(
      this.testManager.detectTestBoundary(
        browserAny.currentTest as NightwatchCurrentTest
      )
    )

    const callInfo = getCallSourceFromStack()
    if (callInfo.filePath && !this.currentTestFullPath) {
      this.currentTestFullPath = callInfo.filePath
    }

    const lastArg = args[args.length - 1]
    const hasUserCallback = typeof lastArg === 'function'
    const userCallback: Function | null = hasUserCallback ? lastArg : null
    const logArgs = hasUserCallback ? args.slice(0, -1) : args

    const cmdSig = JSON.stringify({
      command: methodName,
      args: logArgs,
      src: callInfo.callSource
    })
    this.pushCommandStackIfNew(methodName, cmdSig, callInfo.callSource)

    const callSource = callInfo.callSource
    const commandTimestamp = Date.now()
    const captureCallback = this.makeCaptureCallback(
      browser,
      methodName,
      logArgs,
      cmdSig,
      callSource,
      commandTimestamp,
      this.getCurrentTest()?.uid,
      userCallback
    )
    const modifiedArgs = [...logArgs, captureCallback]
    try {
      return originalMethod(...modifiedArgs)
    } catch (error) {
      this.popCommandStackIfMatches(methodName, cmdSig)
      this.captureCommandError(methodName, logArgs, error, callSource)
      throw error
    }
  }

  private captureCommandError(
    methodName: string,
    args: unknown[],
    error: unknown,
    callSource: string | undefined
  ): void {
    const currentTest = this.getCurrentTest()
    if (!currentTest) {
      return
    }

    const normalizedError = toError(error)
    log.error(`[command error] ${methodName}: ${normalizedError.message}`)

    this.sessionCapturer
      .captureCommand(
        methodName,
        args,
        undefined,
        normalizedError,
        currentTest.uid,
        callSource
      )
      .catch((err) =>
        log.error(`Failed to capture ${methodName}: ${(err as Error).message}`)
      )

    const lastCommand =
      this.sessionCapturer.commandsLog[
        this.sessionCapturer.commandsLog.length - 1
      ]
    if (lastCommand) {
      this.sessionCapturer.sendCommand(lastCommand)
    }
  }

  isProxied(browser: NightwatchBrowser): boolean {
    return this.proxiedBrowsers.has(browser as object)
  }

  /**
   * Fire-and-forget: pull a screenshot via the WebDriver HTTP endpoint and
   * attach it to an already-captured command entry. The `suffix` is appended
   * to the log line so retried-command screenshots show `(retry)`. Errors
   * are silently swallowed — screenshots are best-effort and shouldn't fail
   * the run.
   */
  private attachScreenshot(
    browser: NightwatchBrowser,
    entry: { timestamp?: number; screenshot?: string | null },
    methodName: string,
    suffix = ''
  ): void {
    const ts = entry.timestamp ?? 0
    this.sessionCapturer
      .takeScreenshotViaHttp(browser)
      .then((screenshot) => {
        if (screenshot) {
          entry.screenshot = screenshot
          this.sessionCapturer.sendReplaceCommand(ts, entry as CommandLog)
          log.info(`[screenshot] Attached to ${methodName}${suffix}`)
        }
      })
      .catch(() => {})
  }
}
