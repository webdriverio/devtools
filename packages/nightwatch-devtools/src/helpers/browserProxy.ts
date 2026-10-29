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
import { commandRowSelector, commandTargetSelector } from './assertTarget.js'
import { getCallSourceFromStack } from './utils.js'
import { serializeCommandResult } from './serializeCommandResult.js'
import { NativeAssertRecorder } from './nativeAssertRecorder.js'
import { WaitRows } from './waitRows.js'
import { wrapNavigation } from './navigationWrap.js'
import {
  RetryTracker,
  beginInputDispatch,
  clearReadValues,
  rememberReadValue,
  toError
} from '@wdio/devtools-core'
import { isWaitCommand } from '@wdio/devtools-shared'
import type { SessionCapturer } from '../session.js'
import type { TestManager } from './testManager.js'
import type {
  CommandCaptureMeta,
  CommandInvocation,
  CommandLog,
  NativeAssertCall,
  NightwatchBrowser,
  NightwatchCurrentTest,
  CommandStackFrame,
  OpenWait,
  PendingCommand
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

  private waits: WaitRows

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

  /**
   * The browser every captured row is issued on. Nightwatch mutates ONE browser
   * object in place — even across a mid-run session replacement — so this stays
   * valid for the whole run, and it is how `browser.currentTest` is read from
   * the assert path, which runs outside any command callback.
   */
  private browser: NightwatchBrowser | null = null

  /** The test core's value registry currently holds reads for; see {@link scopeReadValuesToRowTest}. */
  private readValueTestUid: string | undefined

  constructor(
    private readonly sessionCapturer: SessionCapturer,
    private testManager: TestManager,
    private getCurrentTest: () => { uid?: string } | null,
    private captureAssertions = true,
    private observeSession?: (browser: NightwatchBrowser) => void
  ) {
    this.waits = new WaitRows(sessionCapturer)
    this.assertRecorder = new NativeAssertRecorder(
      sessionCapturer,
      () => this.rowTest(),
      () => this.issueCounter++
    )
  }

  /**
   * The test a captured row belongs to: the `it` Nightwatch reports as running
   * right now, falling back to the lifecycle test. On the BDD `describe/it`
   * interface the lifecycle test is the module's FIRST `it` for every row in the
   * file (its `beforeEach` fires once per module), so without the live read
   * every command in the module carried one uid and the trace's action tree
   * collapsed to a single test group. The fallback is what the runners with no
   * per-testcase state keep using — cucumber has no `currentTest` at all.
   */
  private rowTest(): { uid?: string } | null {
    return (
      this.testManager.runningTest(this.browser?.currentTest) ??
      this.getCurrentTest()
    )
  }

  /** The uid rows are stamped with — see {@link rowTest}. Public so the
   *  node:assert capture wiring, which has no command of its own, tags its rows
   *  onto the same test the surrounding commands landed on. */
  rowTestUid(): string | undefined {
    return this.rowTest()?.uid
  }

  /**
   * Forget the values an earlier test read once the running test changes. The
   * lifecycle reset below fires once per MODULE on the BDD interface, so this
   * per-`it` live read is what keeps one `it`'s reads from naming another's
   * assertion target. Called before every record and every lookup.
   */
  scopeReadValuesToRowTest(): void {
    const uid = this.rowTestUid()
    if (uid !== this.readValueTestUid) {
      clearReadValues()
      this.readValueTestUid = uid
    }
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
    clearReadValues()
    this.readValueTestUid = undefined
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

  /** Inject the DevTools script after every navigation; see {@link wrapNavigation}. */
  wrapUrlMethod(browser: NightwatchBrowser): void {
    wrapNavigation(browser, this.sessionCapturer)
  }

  wrapBrowserCommands(browser: NightwatchBrowser): void {
    // Held before the already-wrapped guard: the reference is what `rowTest`
    // reads `currentTest` off, and a re-entry is exactly a run that never
    // re-wraps.
    this.browser = browser
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
    oldId: number,
    methodName: string,
    logArgs: unknown[],
    serializedResult: unknown,
    meta: CommandCaptureMeta,
    commandError: Error | undefined
  ): number | null {
    // Same command fired again (internal retry) — replace the previous
    // entry so only the final result appears in the UI.
    const { entry, oldTimestamp } = this.sessionCapturer.replaceCommand(
      oldId,
      methodName,
      logArgs,
      serializedResult,
      commandError,
      meta
    )
    this.sessionCapturer.sendReplaceCommand(oldTimestamp, entry)
    this.attachScreenshot(browser, entry, methodName, ' (retry)')
    return entry._id ?? null
  }

  private captureFreshCommand(
    browser: NightwatchBrowser,
    methodName: string,
    logArgs: unknown[],
    serializedResult: unknown,
    meta: CommandCaptureMeta,
    commandError: Error | undefined
  ): number | null {
    // captureCommand() pushes the entry to commandsLog synchronously before
    // any async work (navigation perf capture), so the row's id is read
    // straight after the call, before any Nightwatch callback can run.
    // Issued first, and only this one — see `drainOutgoingPage`.
    this.drainOutgoingPage(browser, methodName)
    this.sessionCapturer
      .captureCommand(methodName, logArgs, serializedResult, commandError, meta)
      .catch((err) =>
        log.error(`Failed to capture ${methodName}: ${(err as Error).message}`)
      )
    const lastCommand =
      this.sessionCapturer.commandsLog[
        this.sessionCapturer.commandsLog.length - 1
      ]
    if (lastCommand) {
      this.sessionCapturer.sendCommand(lastCommand)
      log.info(`[command] ${methodName}`)
      this.attachScreenshot(browser, lastCommand, methodName)
    }
    this.anchorDestination(browser, methodName)
    // A DOM-mutating command already drains it through `captureTrace`.
    if (!this.isDomMutating(methodName)) {
      void this.sessionCapturer.nativeNetwork.forward({ throttle: true })
    }
    return (lastCommand as { _id?: number } | undefined)?._id ?? null
  }

  /**
   * Record a completed command. A poll folds into the row of the previous
   * identical call: the last row captured, or, inside a wait, the row of the
   * same call its condition already issued, since a condition with two reads
   * alternates them and never repeats the last one.
   */
  private recordCompleted(
    browser: NightwatchBrowser,
    cmd: PendingCommand,
    meta: CommandCaptureMeta,
    serializedResult: unknown,
    commandError: Error | undefined
  ): void {
    const { methodName, logArgs, cmdSig, parent } = cmd
    const foldInto = parent
      ? parent.children.get(cmdSig)
      : this.retryTracker.isRetry(cmdSig)
        ? this.retryTracker.lastId!
        : undefined
    const id =
      foldInto === undefined
        ? this.captureFreshCommand(
            browser,
            methodName,
            logArgs,
            serializedResult,
            meta,
            commandError
          )
        : this.handleRetryReplacement(
            browser,
            foldInto,
            methodName,
            logArgs,
            serializedResult,
            meta,
            commandError
          )
    if (!parent) {
      this.retryTracker.recordCapture(cmdSig, id)
    } else if (id !== null) {
      parent.children.set(cmdSig, id)
    }
  }

  /** End a wait's row; whatever is captured next is not a poll of what ran before it. */
  private closeWait(
    browser: NightwatchBrowser,
    wait: OpenWait,
    result: unknown,
    error: Error | undefined,
    completedAt: number
  ): void {
    this.retryTracker.reset()
    this.waits.close(wait, result, error, completedAt)
    this.attachScreenshot(browser, wait.row, wait.row.command)
    void this.sessionCapturer.nativeNetwork.forward({ throttle: true })
  }

  private isDomMutating(methodName: string): boolean {
    return (
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
    )
  }

  /**
   * Drains the OUTGOING page's field edits, which die with the document the
   * moment a submit navigates. It goes over the raw HTTP transport, so it
   * touches no Nightwatch queue, and a driver serialises requests per session —
   * so it is served before the next queued command only for as long as it stays
   * the FIRST request this class issues when a command completes. That call
   * position, and the drain-before-perf-logs order inside `captureTrace`, are
   * both load-bearing: behind the snapshot probes and the screenshot it needed
   * about 130 ms of head start and got 18 ms, and the last field a test filled
   * before submitting replayed as an empty box.
   *
   * It deliberately carries only this one request. `anchorAfterNavigation` is
   * issued later, from `anchorDestination`, so the row's own screenshot and DOM
   * snapshot are not pushed behind two round trips.
   */
  private drainOutgoingPage(
    browser: NightwatchBrowser,
    methodName: string
  ): void {
    if (!this.isDomMutating(methodName)) {
      return
    }
    this.sessionCapturer.captureTrace(browser, true).catch(() => {})
  }

  /**
   * Anchors the DESTINATION, and it has to wait: a Nightwatch click resolves
   * before its navigation commits, so the outgoing drain still finds the old
   * page's collector, recovers nothing, and the new document is never anchored —
   * every action on it then replayed the page it came from (measured: 5 of 20
   * rows). `anchorAfterNavigation` keys off the document actually being replaced
   * rather than off which command ran, so it covers any route to a new document —
   * a submit click, a JS redirect, a same-command re-navigation — without a list
   * of commands to keep in sync.
   */
  private anchorDestination(
    browser: NightwatchBrowser,
    methodName: string
  ): void {
    if (!this.isDomMutating(methodName)) {
      return
    }
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

  /** Serialize the result and record which element produced it, so a later
   *  node:assert on that value can name its target (core's value→locator
   *  registry). Fed for every command, so a page-level read records "no
   *  element" — see `rememberReadValue` for why that sentinel matters. Folded
   *  into one call because `makeCaptureCallback` is already over the line cap. */
  private serializeAndAttributeResult(
    methodName: string,
    logArgs: unknown[],
    callbackResult: unknown
  ): unknown {
    const result = serializeCommandResult(callbackResult, methodName)
    this.scopeReadValuesToRowTest()
    rememberReadValue(result, commandTargetSelector(methodName, logArgs))
    return result
  }

  // Result-capturing callback factory — called by Nightwatch's async queue
  // when the command completes. This is where we get the *actual* result.
  private makeCaptureCallback(
    browser: NightwatchBrowser,
    cmd: PendingCommand
  ): (callbackResult: unknown) => unknown {
    const { methodName, logArgs, cmdSig, userCallback } = cmd
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
        : this.serializeAndAttributeResult(methodName, logArgs, callbackResult)
      const effectiveUid = this.rowTestUid() ?? cmd.testUid
      if (cmd.wait) {
        this.closeWait(
          browser,
          cmd.wait,
          serializedResult,
          commandError,
          commandTimestamp
        )
      } else if (effectiveUid && cmd.hasUserSource) {
        // Only surface commands that originate from a user-code frame. Commands
        // Nightwatch issues from inside its own queue (e.g. the getTitle a
        // `browser.assert.titleContains` runs) execute in a detached tick with no
        // user frame on the stack, so they'd otherwise leak as top-level actions
        // with an "unknown" source. Mirrors the service's user-spec-source guard.
        this.recordCompleted(
          browser,
          cmd,
          {
            testUid: effectiveUid,
            callSource: cmd.callSource,
            timestamp: commandTimestamp,
            startTime: cmd.invokedAt,
            sequence: cmd.sequence,
            selector: commandRowSelector(methodName, logArgs),
            parentId: cmd.parent?.row.id
          },
          serializedResult,
          commandError
        )
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
    // `waitUntil`'s first argument is its condition, never a result callback.
    const hasUserCallback =
      typeof lastArg === 'function' &&
      !(methodName === 'waitUntil' && args.length === 1)
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
    // The command's session id is the only evidence a mid-run `browser.end()`
    // leaves behind — Nightwatch raises no event and `end` is never wrapped.
    this.observeSession?.(browser)
    this.testManager.startTestIfPending(
      this.testManager.detectTestBoundary(
        browserAny.currentTest as NightwatchCurrentTest
      )
    )

    const cmd = this.pendingCommand(methodName, args)
    const captureCallback = this.makeCaptureCallback(browser, cmd)
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
    const modifiedArgs = [...this.waits.args(cmd), gatedCallback]
    try {
      return originalMethod(...modifiedArgs)
    } catch (error) {
      closeInputWindow()
      this.popCommandStackIfMatches(methodName, cmd.cmdSig)
      if (cmd.wait) {
        this.closeWait(browser, cmd.wait, undefined, toError(error), Date.now())
      } else {
        this.captureCommandError(methodName, cmd.logArgs, error, cmd.callSource)
      }
      throw error
    }
  }

  /** Describe the call, and send its row now when it is a wait. */
  private pendingCommand(methodName: string, args: unknown[]): PendingCommand {
    const cmd: PendingCommand = {
      ...this.describeInvocation(methodName, args),
      methodName,
      // Invocation time only: the row's real completion stamp is taken inside
      // the capture callback (see makeCaptureCallback).
      invokedAt: Date.now(),
      sequence: this.issueCounter++,
      testUid: this.rowTestUid(),
      parent: this.waits.enclosing()
    }
    if (isWaitCommand(methodName) && cmd.testUid && cmd.hasUserSource) {
      // A wait breaks a run of identical calls: a read after it is not a poll of the read before it.
      this.retryTracker.reset()
      cmd.wait = this.waits.open(cmd)
      log.info(`[command] ${methodName} (running)`)
    }
    return cmd
  }

  private captureCommandError(
    methodName: string,
    args: unknown[],
    error: unknown,
    callSource: string | undefined
  ): void {
    const currentTest = this.rowTest()
    if (!currentTest) {
      return
    }

    const normalizedError = toError(error)
    log.error(`[command error] ${methodName}: ${normalizedError.message}`)

    this.sessionCapturer
      .captureCommand(methodName, args, undefined, normalizedError, {
        testUid: currentTest.uid,
        callSource,
        selector: commandRowSelector(methodName, args)
      })
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
        // A retry has replaced the row meanwhile, and its replacement carries the same `id`.
        if (
          screenshot &&
          this.sessionCapturer.commandsLog.includes(entry as CommandLog)
        ) {
          entry.screenshot = screenshot
          this.sessionCapturer.sendReplaceCommand(ts, entry as CommandLog)
          log.info(`[screenshot] Attached to ${methodName}${suffix}`)
        }
      })
      .catch(() => {})
  }
}
