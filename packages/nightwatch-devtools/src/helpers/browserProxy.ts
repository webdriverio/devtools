/**
 * Browser Proxy
 * Handles browser command interception and tracking
 */

import logger from '@wdio/logger'
import {
  INTERNAL_COMMANDS_TO_IGNORE,
  NAVIGATION_COMMANDS
} from '../constants.js'
import { callbackError } from './callbackError.js'
import { getCallSourceFromStack } from './utils.js'
import { serializeCommandResult } from './serializeCommandResult.js'
import { NativeAssertRecorder } from './nativeAssertRecorder.js'
import { RetryTracker, beginInputDispatch, toError } from '@wdio/devtools-core'
import type { SessionCapturer } from '../session.js'
import type { TestManager } from './testManager.js'
import type {
  CommandInvocation,
  CommandLog,
  NativeAssertCall,
  NightwatchBrowser,
  NightwatchChainable,
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

  /**
   * Monotonic issue-order counter. Stamped when the test ISSUES a row — a
   * driver command at invocation, an assert at enqueue — which is source order.
   * Both are recorded into `commandsLog` much later and out of that order (a
   * driver command at completion, an assert in the test-end batch), so this is
   * what lets the exporter recover the order the test wrote. Shared with the
   * assert recorder so both row kinds draw from one sequence.
   */
  private issueCounter = 0

  private assertRecorder: NativeAssertRecorder

  constructor(
    private sessionCapturer: SessionCapturer,
    private testManager: TestManager,
    private getCurrentTest: () => { uid?: string } | null,
    private captureAssertions = true
  ) {
    this.assertRecorder = new NativeAssertRecorder(
      sessionCapturer,
      getCurrentTest,
      () => this.issueCounter++
    )
  }

  /**
   * Update the session capturer reference after a WebDriver session change.
   * Does NOT re-wrap browser methods — wrapping is permanent per browser object.
   */
  updateSessionCapturer(capturer: SessionCapturer): void {
    this.sessionCapturer = capturer
    this.assertRecorder.updateSessionCapturer(capturer)
  }

  /** Per-command-scope dedup state only. Cucumber calls this per STEP, so it
   *  must not touch the native-assert buffer — that buffer spans the whole
   *  scenario and is drained once, at the scenario's pre-quit hook. */
  resetCommandTracking(): void {
    this.commandStack = []
    this.lastCommandSig = null
    this.retryTracker.reset()
  }

  /** Everything scoped to one test unit: dedup state plus any native-assert
   *  calls a previous unit left behind because its drain never ran. */
  resetTestTracking(): void {
    this.resetCommandTracking()
    this.assertRecorder.clear()
  }

  /** Hand off this test's recorded native-assertion calls and clear the
   *  buffer so the next test starts fresh. */
  drainNativeAssertCalls(): NativeAssertCall[] {
    return this.assertRecorder.drain()
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
        // `browser.url()` is BOTH a navigation and a getter: with no url it just
        // reads the current one, which is how `assert.urlContains` reads it from
        // inside Nightwatch's own queue. Treating that read as a navigation
        // re-injected the collector and forced an anchored drain mid-test — real
        // round trips against the page for a command that changed nothing — and
        // logged the capture callback's whole function body as the "url".
        if (typeof args[0] !== 'string') {
          return original(...args)
        }
        const result = original(...args)

        const injectAndCapture = () => {
          log.info(`[nav] ${methodName}(${args[0] ?? ''}) — injecting script`)
          return (
            sessionCapturer
              .injectScript(browser)
              // Anchored: the just-injected collector anchors the document
              // asynchronously, so an unanchored drain beats it and this page's
              // DOM never reaches the trace.
              .then(() => sessionCapturer.captureTrace(browser, true))
              .catch((err: Error) =>
                log.error(`Failed to inject script: ${(err as Error).message}`)
              )
          )
        }

        const chainable = result as NightwatchChainable | undefined
        if (chainable && typeof chainable.perform === 'function') {
          // Standard Nightwatch (chained API). Hung off the command's OWN
          // thenable, not a queued `perform()`: a queued callback is discarded
          // when a failing test aborts the rest of the queue, so the destination
          // of a navigation in a failing test was never instrumented at all
          // (measured: 2 of 3 navigations skipped, and with them the first
          // document's entire DOM). The chainable is itself thenable, and
          // resolving it means the navigation finished — the same signal
          // `perform` gave, minus the dependency on the queue surviving.
          //
          // `result` is returned unchanged so `browser.url(…).waitFor…()`
          // chaining still works; the injection runs as a side effect.
          void Promise.resolve(result)
            .then(injectAndCapture)
            .catch(() => {})
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

    // captureAssertions:false → leave assert/verify original so no native
    // assertion rows are recorded (the finalize paths are gated to match).
    if (this.captureAssertions) {
      this.assertRecorder.wrapNamespaces(browser)
    }
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
    commandTimestamp: number,
    invokedAt: number,
    sequence: number,
    commandError: Error | undefined
  ): void {
    // Same command fired again (internal retry) — replace the previous
    // entry so only the final result appears in the UI.
    const { entry, oldTimestamp } = this.sessionCapturer.replaceCommand(
      this.retryTracker.lastId!,
      methodName,
      logArgs,
      serializedResult,
      commandError,
      effectiveUid,
      callSource,
      commandTimestamp
    )
    entry.startTime = invokedAt
    entry.sequence = sequence
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
    cmdSig: string,
    invokedAt: number,
    sequence: number,
    commandError: Error | undefined
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
        commandError,
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
      lastCommand.startTime = invokedAt
      lastCommand.sequence = sequence
      this.retryTracker.setLastId((lastCommand as { _id?: number })._id ?? null)
      this.sessionCapturer.sendCommand(lastCommand)
      log.info(`[command] ${methodName}`)
      this.attachScreenshot(browser, lastCommand, methodName)
    }
    this.maybeRepollMutations(browser, methodName)
  }

  /**
   * After a DOM-mutating command, drain the collector — TWICE, for two different
   * reasons that no single drain can serve.
   *
   * The first drain fires synchronously, with no setTimeout in front. It used to
   * defer 200ms to stay off Nightwatch's callback stack, safe only because the
   * drain went through `browser.execute`, a QUEUED command; over the raw HTTP
   * transport it touches no queue, and because a driver serialises requests per
   * session, a drain issued here is served BEFORE the next queued command. That
   * is what captures the OUTGOING page's field edits — deferred, a submit click
   * navigated first and they died with the page, so the `#password` fill row
   * replayed with an empty password box.
   *
   * The second drain is what anchors the DESTINATION, and it has to wait: a
   * Nightwatch click resolves before its navigation commits, so the first drain
   * still finds the outgoing page's collector, recovers nothing, and the new
   * document is never anchored — every action on it then replayed the page it
   * came from (measured: 5 of 20 rows). `anchorAfterNavigation` keys off the
   * document actually being replaced rather than off which command ran, so it
   * covers any route to a new document — a submit click, a JS redirect, a
   * same-command re-navigation — without a list of commands to keep in sync.
   */
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
    this.sessionCapturer.captureTrace(browser, true).catch(() => {})
    // Tracked so finalize awaits it — an untracked anchor drain can still be in
    // flight when the trace is written, which loses the document entirely.
    this.sessionCapturer.snapshotCaptures.push(
      this.sessionCapturer.anchorAfterNavigation(browser).catch(() => {})
    )
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
    hasUserSource: boolean,
    invokedAt: number,
    sequence: number,
    testUid: string | undefined,
    userCallback: Function | null
  ): (callbackResult: unknown) => unknown {
    return (callbackResult: unknown) => {
      // Stamped HERE, when the command actually finished in the browser — not
      // when the test enqueued it. Nightwatch runs commands off a queue, so
      // invocation leads real execution by hundreds of ms, and the page-side
      // mutation stream is on real time: a row stamped at invocation replayed
      // the page from BEFORE its own effect (the `#username` fill rendered an
      // empty field, the `#password` fill rendered only the username). The
      // invocation time becomes the row's `startTime`, so the row also spans its
      // real duration instead of a synthetic 1ms.
      const commandTimestamp = Date.now()
      this.popCommandStackIfMatches(methodName, cmdSig)
      const commandError = callbackError(callbackResult)
      const serializedResult = commandError
        ? undefined
        : serializeCommandResult(callbackResult, methodName)
      const effectiveUid = this.getCurrentTest()?.uid ?? testUid
      // Only surface commands that originate from a user-code frame. Commands
      // Nightwatch issues from inside its own queue (e.g. the getTitle a
      // `browser.assert.titleContains` runs) execute in a detached tick with no
      // user frame on the stack, so they'd otherwise leak as top-level actions
      // with an "unknown" source. Mirrors the service's user-spec-source guard.
      if (effectiveUid && hasUserSource) {
        if (this.retryTracker.isRetry(cmdSig)) {
          this.handleRetryReplacement(
            browser,
            methodName,
            logArgs,
            serializedResult,
            effectiveUid,
            callSource,
            commandTimestamp,
            invokedAt,
            sequence,
            commandError
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
            cmdSig,
            invokedAt,
            sequence,
            commandError
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

  private describeInvocation(
    methodName: string,
    args: unknown[]
  ): CommandInvocation {
    const callInfo = getCallSourceFromStack()
    if (callInfo.filePath && !this.currentTestFullPath) {
      this.currentTestFullPath = callInfo.filePath
    }
    const lastArg = args[args.length - 1]
    const hasUserCallback = typeof lastArg === 'function'
    const logArgs = hasUserCallback ? args.slice(0, -1) : args
    const cmdSig = JSON.stringify({
      command: methodName,
      args: logArgs,
      src: callInfo.callSource
    })
    this.pushCommandStackIfNew(methodName, cmdSig, callInfo.callSource)
    return {
      userCallback: hasUserCallback
        ? (lastArg as (result: unknown) => unknown)
        : null,
      logArgs,
      cmdSig,
      callSource: callInfo.callSource,
      hasUserSource: callInfo.filePath !== undefined
    }
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

    const { userCallback, logArgs, cmdSig, callSource, hasUserSource } =
      this.describeInvocation(methodName, args)
    // Invocation time only — the row's real completion stamp is taken inside the
    // capture callback (see makeCaptureCallback).
    const invokedAt = Date.now()
    const sequence = this.issueCounter++
    const captureCallback = this.makeCaptureCallback(
      browser,
      methodName,
      logArgs,
      cmdSig,
      callSource,
      hasUserSource,
      invokedAt,
      sequence,
      this.getCurrentTest()?.uid,
      userCallback
    )
    // Suppress screencast polling while this command may be dispatching input: a
    // screenshot landing mid-click makes the click activate nothing. Enqueue is
    // the only hook the adapter has — Nightwatch executes off a queue it exposes
    // no start event for — so an awaited call (enqueue ≈ execution) is covered,
    // while one queued behind a long wait can see its window expire before it
    // runs. The bound is what keeps that from stalling the recorder instead.
    const closeInputWindow = beginInputDispatch(methodName)
    const gatedCallback = (callbackResult: unknown) => {
      closeInputWindow()
      return captureCallback(callbackResult)
    }
    const modifiedArgs = [...logArgs, gatedCallback]
    try {
      return originalMethod(...modifiedArgs)
    } catch (error) {
      closeInputWindow()
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
