/// <reference types="../../script/types.d.ts" />
import logger from '@wdio/logger'
import {
  deterministicUid,
  errorMessage,
  finalizeScreencast,
  mapCommandToAction,
  recordSpecBoundary,
  resolveAdapterOutputDir,
  type SpecRange,
  writeSpecTrace,
  writeTraceZip
} from '@wdio/devtools-core'
import { captureActionSnapshot } from './action-snapshot.js'
import { dedupeSnapshotsByTimestamp } from './snapshot-dedupe.js'
import type { ActionSnapshot, TestMetadataMap } from '@wdio/devtools-shared'
import { SevereServiceError } from 'webdriverio'
import type { Services, Capabilities, Options, Reporters } from '@wdio/types'
import type { WebDriverCommands } from '@wdio/protocols'

import { SessionCapturer } from './session.js'
import { TestReporter } from './reporter.js'
import { DevToolsAppLauncher } from './launcher.js'
import { getBrowserObject, isUserSpecFile } from './utils.js'
import { ScreencastRecorder } from './screencast.js'
import { attachBidiListeners } from './bidi-listeners.js'
import { parse } from 'stack-trace'
import {
  type ScreencastOptions,
  type ServiceOptions,
  TraceType
} from './types.js'
import { CONTEXT_CHANGE_COMMANDS, INTERNAL_COMMANDS } from './constants.js'
import { isNativeMobile } from './mobile.js'
import { detectInvocationConfigPath } from './standalone.js'

export * from './types.js'
export const launcher = DevToolsAppLauncher

const log = logger('@wdio/devtools-service')

type CommandFrame = {
  command: string
  callSource?: string
  startTimestamp: number
}

export { setupForDevtools } from './standalone.js'

export default class DevToolsHookService implements Services.ServiceInstance {
  #testReporters: TestReporter[] = []
  #sessionCapturer = new SessionCapturer()
  #browser?: WebdriverIO.Browser
  #bidiListenersSetup = false
  #screencastRecorder?: ScreencastRecorder
  #screencastOptions?: ScreencastOptions
  #options: ServiceOptions
  #actionSnapshots: ActionSnapshot[] = []

  constructor(serviceOptions: ServiceOptions = {}) {
    this.#options = serviceOptions
    if (serviceOptions.mode === 'trace' && serviceOptions.screencast?.enabled) {
      log.warn('trace mode: ignoring screencast option (live-mode feature)')
      this.#screencastOptions = undefined
    } else {
      this.#screencastOptions = serviceOptions.screencast
    }
  }

  /**
   * This is used to capture the command stack to ensure that we only capture
   * commands that are top-level user commands.
   */
  #commandStack: CommandFrame[] = []

  /** Current test UID, set in beforeTest(), used by afterCommand() to tag commands. */
  #currentTestUid?: string

  /** Map of testUid → metadata for trace group events and per-spec partitioning. */
  #testMetadata: TestMetadataMap = new Map()

  /** Index ranges into the session capturer's flat arrays, one per spec file. */
  #specRanges: SpecRange[] = []

  /** Set of spec files already flushed to disk. */
  #flushedSpecs = new Set<string>()

  /** Build the boundary context for recordSpecBoundary — the same shape is
   *  needed in both beforeTest and beforeScenario. */
  get #boundaryContext() {
    return {
      specRanges: this.#specRanges,
      flushedSpecs: this.#flushedSpecs,
      capturer: this.#sessionCapturer,
      actionSnapshots: this.#actionSnapshots
    }
  }

  /** Fire-and-forget flush of a previous spec's trace. The error log is
   *  inline so the spec-file reference stays precise. */
  #fireAndForgetFlush(prevRange: SpecRange): void {
    void this.#flushSpecTrace(prevRange).catch((err) =>
      log.warn(
        `Failed to flush trace for spec "${prevRange.specFile}": ${errorMessage(err)}`
      )
    )
  }

  /**
   * allows to define the type of data being captured to hint the
   * devtools app which data to expect
   */
  captureType = TraceType.Testrunner

  // This is used to track if the injection script is currently being injected
  #injecting = false

  async before(
    caps: Capabilities.W3CCapabilities,
    __: string[],
    browser: WebdriverIO.Browser
  ) {
    this.#browser = browser

    /**
     * create a new session capturer instance with the devtools options
     */
    const wdioCaps = caps as Capabilities.W3CCapabilities & {
      'wdio:devtoolsOptions'?: ServiceOptions
    }
    this.#sessionCapturer = new SessionCapturer(
      wdioCaps['wdio:devtoolsOptions']
    )

    /**
     * Block until injection completes BEFORE any test commands.
     * Skip on native mobile — Appium sessions don't support WebDriver BiDi
     * and the injection always fails with SevereServiceError.
     */
    if (!isNativeMobile(browser)) {
      try {
        await this.#injectScriptSync(browser)
      } catch (err) {
        log.error(
          `Failed to inject script at session start: ${errorMessage(err)}`
        )
      }
    }

    /**
     * Start screencast recording if the user has enabled it.
     * Options come from the service constructor (services: [['devtools', { screencast: { enabled: true } }]]).
     * Failures are non-fatal — a warning is logged and the session continues.
     */
    if (this.#screencastOptions?.enabled) {
      this.#screencastRecorder = new ScreencastRecorder(this.#screencastOptions)
      await this.#screencastRecorder.start(browser)
    }

    /**
     * propagate session metadata at the beginning of the session.
     * Skip on mobile — Appium sessions don't have a browser DOM context.
     */
    if (!isNativeMobile(browser)) {
      browser
        .execute(() => window.visualViewport)
        .then((viewport) =>
          this.#sessionCapturer.sendUpstream('metadata', {
            viewport: viewport || undefined,
            type: this.captureType,
            options: browser.options,
            capabilities: browser.capabilities as Capabilities.W3CCapabilities
          })
        )
    }

    /**
     * Runtime DOM snapshot for agent auto-healing loops. Calls into
     * @wdio/elements' getSnapshot() directly — no trace-mode overhead,
     * no screenshot round-trip, no page-settling.
     *
     * Returns { text, elements } — see @wdio/elements SnapshotResult.
     */
    browser.addCommand('getSnapshot', async (options?: { inViewportOnly?: boolean }) => {
      const { getSnapshot } = await import('@wdio/elements')
      return getSnapshot(browser, options ?? { inViewportOnly: true })
    })
  }

  // The method signature is corrected to use W3CCapabilities
  beforeSession(
    config: Options.Testrunner,
    capabilities: Capabilities.W3CCapabilities
  ) {
    const isMultiRemote =
      !('browserName' in capabilities) && !('platformName' in capabilities)
    if (isMultiRemote) {
      throw new SevereServiceError(
        'The DevTools hook does not support multiremote yet'
      )
    }

    const detectedConfig = detectInvocationConfigPath()
    if (detectedConfig) {
      this.#sessionCapturer.sendUpstream('config', {
        configFile: detectedConfig
      })
    }

    if ('reporters' in config) {
      const self = this
      config.reporters = [
        ...(config.reporters || []),
        /**
         * class wrapper to make sure we can access the reporter instance
         */
        class DevToolsReporter extends TestReporter {
          constructor(options: Reporters.Options) {
            super(
              options,
              (upstreamData) =>
                self.#sessionCapturer.sendUpstream('suites', upstreamData),
              (location: string) => {
                self.#sessionCapturer.ensureSourceLoaded(location)
              }
            )
            self.#testReporters.push(this)
          }
        }
      ]
    }
  }

  /**
   * Hook for Cucumber framework.
   * Detects feature-file boundaries for per-spec tracing and tags commands
   * with a stable testUid so tracingGroup spans render in the trace output.
   * WDIO passes the Cucumber World as the first argument.
   */
  beforeScenario(world?: { pickle?: { uri?: string; name?: string } }) {
    this.resetStack()

    const featureFile = world?.pickle?.uri
    const scenarioName = world?.pickle?.name

    // ── Per-spec boundary detection (Cucumber) ──
    if (featureFile) {
      const prevRange = recordSpecBoundary(
        this.#boundaryContext,
        featureFile,
        this.#options.traceGranularity
      )
      if (prevRange) {
        this.#fireAndForgetFlush(prevRange)
      }
    }

    // ── Test identity for command tagging ──
    if (featureFile && scenarioName) {
      const uid = deterministicUid(featureFile, scenarioName)
      this.#currentTestUid = uid
      this.#testMetadata.set(uid, {
        title: scenarioName,
        specFile: featureFile
      })
    }
  }

  /**
   * Hook for Mocha/Jasmine frameworks.
   * It does the exact same thing as beforeScenario.
   */
  beforeTest(test?: { file?: string; title?: string; fullTitle?: string }) {
    this.resetStack()

    const newSpec = test?.file

    // ── Per-spec boundary detection ──
    // Only tracked when traceGranularity is 'spec'. Records array index
    // ranges so #flushSpecTrace can slice the accumulated data per spec.
    if (newSpec) {
      const prevRange = recordSpecBoundary(
        this.#boundaryContext,
        newSpec,
        this.#options.traceGranularity
      )
      if (prevRange) {
        this.#fireAndForgetFlush(prevRange)
      }
    }

    // Track test identity for command tagging. Generate a stable UID
    // from file + title so commands can be partitioned across reruns.
    // WDIO's Test type always provides `fullTitle`; `title` is a
    // fallback for non-WDIO frameworks.
    const testTitle = test?.fullTitle || test?.title
    if (test?.file && testTitle) {
      const uid = deterministicUid(test.file, testTitle)
      this.#currentTestUid = uid
      this.#testMetadata.set(uid, {
        title: testTitle,
        specFile: test.file
      })
    } else if (testTitle) {
      this.#currentTestUid = testTitle
      this.#testMetadata.set(testTitle, {
        title: testTitle,
        specFile: test.file ?? ''
      })
    }
  }

  async afterScenario() {
    await this.#finalizePerScenario()
  }

  async afterTest() {
    await this.#finalizePerScenario()
  }

  async #finalizePerScenario() {
    if (this.#options.mode !== 'trace' || !this.#browser) {
      return
    }
    const stamp = this.#lastActionTimestamp()
    const snap = await captureActionSnapshot(this.#browser, '__final__')
    if (snap) {
      snap.timestamp = stamp
      this.#actionSnapshots.push(snap)
    }
  }

  #lastActionTimestamp(): number {
    const commands = this.#sessionCapturer.commandsLog
    for (let i = commands.length - 1; i >= 0; i--) {
      const cmd = commands[i]!
      if (mapCommandToAction(cmd.command)) {
        return cmd.timestamp
      }
    }
    return Date.now()
  }

  // Post-action capture: the state RESULTING from the action just completed.
  // The pre-action capture in beforeCommand only records the state before the
  // NEXT mapped action — when intervening commands (assertions, reloadSession)
  // change the page first, an action's result (e.g. the page a click navigated
  // to) is never captured.
  //
  // readyState alone is unreliable: right after a click the OLD document still
  // reports 'complete', so a naive wait snapshots a blank mid-navigation frame.
  // Instead, beforeCommand tags the document; if the tag is gone the action
  // navigated, so we wait for the NEW document to finish loading AND render
  // content before screenshotting its destination. Stamped at this command's
  // own end (the latest logged action).
  async #captureActionResult(command: string): Promise<void> {
    if (
      this.#options.mode !== 'trace' ||
      !this.#browser ||
      !mapCommandToAction(command) ||
      INTERNAL_COMMANDS.includes(command)
    ) {
      return
    }
    const browser = this.#browser
    if (!isNativeMobile(browser)) {
      await this.#waitForResult(browser)
    }
    const snap = await captureActionSnapshot(browser, command)
    if (snap) {
      snap.timestamp = this.#lastActionTimestamp()
      this.#actionSnapshots.push(snap)
    }
  }

  async #waitForResult(browser: WebdriverIO.Browser): Promise<void> {
    const navigated = await browser
      .execute(
        () => !(window as Window & { __wdioSnapMark?: boolean }).__wdioSnapMark
      )
      .catch(() => true)
    if (!navigated) {
      return
    }
    // Action triggered a navigation — wait for the destination document to load
    // and render content so we screenshot the result page, not a blank frame.
    await browser
      .waitUntil(
        async () =>
          (await browser
            .execute(
              () =>
                document.readyState === 'complete' &&
                !!document.body &&
                document.body.childElementCount > 0
            )
            .catch(() => false)) === true,
        { timeout: 8000, interval: 150 }
      )
      .catch(() => undefined)
    // Headless renderers can return a blank shot right after load; let it paint.
    await browser.pause(250).catch(() => undefined)
  }

  private resetStack() {
    this.#commandStack = []
    this.#sessionCapturer.resetLastSelector()
    this.#sessionCapturer.resetRetryTracker()
  }

  #resolveCallSourceFromFrame(
    frame: ReturnType<typeof parse>[number]
  ): string | undefined {
    const rawFile = frame.getFileName() ?? undefined
    let absPath = rawFile
    if (rawFile?.startsWith('file://')) {
      try {
        const url = new URL(rawFile)
        absPath = decodeURIComponent(url.pathname)
      } catch {
        absPath = rawFile
      }
    }
    if (absPath?.includes('?')) {
      absPath = absPath.split('?')[0]
    }
    if (absPath === undefined) {
      return undefined
    }
    const line = frame.getLineNumber() ?? undefined
    const column = frame.getColumnNumber() ?? undefined
    return `${absPath}:${line ?? 0}:${column ?? 0}`
  }

  #pushTopLevelCommandFrame(
    command: string,
    callSource: string | undefined
  ): void {
    if (INTERNAL_COMMANDS.includes(command)) {
      return
    }
    const top = this.#commandStack[this.#commandStack.length - 1]
    if (!top || top.command !== command || top.callSource !== callSource) {
      this.#commandStack.push({
        command,
        callSource,
        startTimestamp: Date.now()
      })
    }
  }

  async beforeCommand(command: string, args: string[]) {
    if (!this.#browser) {
      return
    }
    // BiDi listeners attach on the first command (before any execute).
    if (!this.#bidiListenersSetup && this.#browser.isBidi) {
      this.#bidiListenersSetup = true
      attachBidiListeners(this.#browser, this.#sessionCapturer)
    }
    // On first URL navigation, mark the start of meaningful recording so
    // leading blank frames (pre-test pauses, etc.) are trimmed from the video.
    // Fires regardless of runner (Mocha, Jasmine, Cucumber, standalone).
    if (command === 'url') {
      this.#screencastRecorder?.setStartMarker()
      this.#sessionCapturer.sendUpstream('metadata', { url: args[0] })
    }
    // Smart stack filtering to detect top-level user commands.
    Error.stackTraceLimit = 20
    const stack = parse(new Error('')).reverse()
    const source = stack.find((frame) => isUserSpecFile(frame.getFileName()))
    if (source && this.#commandStack.length === 0) {
      this.#pushTopLevelCommandFrame(
        command,
        this.#resolveCallSourceFromFrame(source)
      )

      // Pre-action capture: state BEFORE this action executes.  Will be
      // stamped at the previous action's end time (or 0 for the first).
      if (
        this.#options.mode === 'trace' &&
        this.#browser &&
        mapCommandToAction(command) &&
        !INTERNAL_COMMANDS.includes(command)
      ) {
        const snap = await captureActionSnapshot(this.#browser, command)
        if (snap) {
          snap.timestamp = this.#lastActionTimestamp()
          this.#actionSnapshots.push(snap)
        }
        // Tag the current document so the post-action capture can tell whether
        // this action navigated (a new document drops the tag).
        await this.#markDocument()
      }
    }
  }

  #markDocument(): Promise<unknown> {
    if (!this.#browser || isNativeMobile(this.#browser)) {
      return Promise.resolve()
    }
    return this.#browser
      .execute(() => {
        ;(window as Window & { __wdioSnapMark?: boolean }).__wdioSnapMark = true
      })
      .catch(() => undefined)
  }

  async afterCommand(
    command: keyof WebDriverCommands,
    args: unknown[],
    result: unknown,
    error?: Error
  ) {
    // Skip bookkeeping for internal injection calls
    if (this.#injecting) {
      return
    }

    /* Ensure that the command is captured only if it matches the last command in the stack.
     * This prevents capturing commands that are not top-level user commands.
     */
    const frame = this.#commandStack[this.#commandStack.length - 1]
    if (frame?.command === command) {
      this.#commandStack.pop()
      if (this.#browser) {
        const captured = await this.#sessionCapturer.afterCommand(
          this.#browser,
          command,
          args,
          result,
          error,
          frame.callSource,
          frame.startTimestamp,
          this.#currentTestUid
        )
        await this.#captureActionResult(command)
        return captured
      }
    }

    // Re-inject AFTER context-changing commands complete so new documents/frames are instrumented
    if (CONTEXT_CHANGE_COMMANDS.includes(command)) {
      void this.#ensureInjected(`context-change:${command}`)
    }
  }

  /**
   * Slice the session capturer's accumulated arrays for a single spec file
   * and write a standalone trace artifact. Called at spec boundaries and
   * from after() for the final spec.
   */
  async #flushSpecTrace(
    range: SpecRange,
    nextRange?: SpecRange
  ): Promise<string | undefined> {
    if (!this.#browser || this.#flushedSpecs.has(range.specFile)) {
      return undefined
    }
    this.#flushedSpecs.add(range.specFile)

    const tracePath = await writeSpecTrace({
      range,
      nextRange,
      capturer: this.#sessionCapturer,
      actionSnapshots: this.#actionSnapshots,
      sessionId: this.#browser.sessionId,
      outputDir: this.#outputDir,
      format: this.#options.traceFormat,
      testMetadata: this.#testMetadata,
      capabilities: this.#browser.capabilities
    })
    log.info(`Trace for spec "${range.specFile}" saved to ${tracePath}`)
    return tracePath
  }

  /**
   * after hook is triggered at the end of every worker session, therefore
   * we can use it to write all trace information to a file
   */
  async after() {
    if (!this.#browser) {
      return
    }

    // Stop and encode the screencast for the current session.
    await this.#finalizeScreencast(this.#browser.sessionId)

    // `trace` mode writes the shareable trace.zip (opened via `pnpm
    // show-trace`); `live` mode streams to the dashboard over WS and persists
    // nothing to disk.
    if (this.#options.mode === 'trace') {
      if (
        this.#options.traceGranularity === 'spec' &&
        this.#specRanges.length > 0
      ) {
        // Per-spec traces — flush each detected spec range.
        for (const range of this.#specRanges) {
          await this.#flushSpecTrace(range)
        }
      } else {
        if (this.#options.traceGranularity === 'spec') {
          log.warn(
            'traceGranularity is "spec" but no spec boundaries were ' +
              'detected (framework may not support service-level test ' +
              'hooks). Falling back to session-level trace.'
          )
        }
        // Session-level trace. Snapshots can share a timestamp (an action's
        // post-action result plus the next action's pre-capture and the
        // per-scenario final capture); the writer keys resources by timestamp,
        // so keep the richest per timestamp — a navigated action's result wins
        // over a blank mid-navigation frame.
        const snapshots = dedupeSnapshotsByTimestamp(this.#actionSnapshots)
        try {
          const tracePath = await writeTraceZip(this.#sessionCapturer, {
            outputDir: this.#outputDir,
            sessionId: this.#browser.sessionId,
            capabilities: this.#browser.capabilities,
            actionSnapshots: snapshots.length ? snapshots : undefined,
            format: this.#options.traceFormat,
            testMetadata: this.#testMetadata
          })
          log.info(`Trace saved to ${tracePath}`)
        } catch (err) {
          log.error(`Trace write failed: ${errorMessage(err)}`)
        }
      }
    }

    // Clean up console patching
    this.#sessionCapturer.cleanup()
  }

  /**
   * Called by WebdriverIO after browser.reloadSession() completes.
   * The old browser session (and its CDP connection) is destroyed at this
   * point, so any in-flight screencast is already dead. We encode whatever
   * frames were captured for the old session and then start a fresh recorder
   * on the new session so the second scenario is also covered.
   */
  async onReload(oldSessionId: string, _newSessionId: string) {
    if (!this.#screencastOptions?.enabled || !this.#browser) {
      return
    }

    // Finalize the recording from the old session (CDP is already gone, so
    // stop() will fail gracefully and we encode whatever frames arrived).
    await this.#finalizeScreencast(oldSessionId)

    // Start a new recorder for the new session.
    this.#screencastRecorder = new ScreencastRecorder(this.#screencastOptions)
    await this.#screencastRecorder.start(this.#browser)
  }

  /**
   * Resolves the directory where devtools output files (trace JSON, video WebM)
   * should be written.
   *
   * WDIO-specific quirk: `wdio.conf.ts`'s `outputDir` (or the auto-set
   * `rootDir`) is the authoritative location — both are honored as-is via
   * `userConfiguredDir`, bypassing the test-file fallback. This preserves
   * the long-standing WDIO behavior of writing files next to the config.
   * Falls back to `process.cwd()`.
   *
   * NOTE: Avoid setting `outputDir` in wdio.conf just to fix the output path
   * — doing so redirects WDIO worker logs to files and silences the terminal.
   * Rely on `rootDir` instead (it is set automatically by WDIO).
   */
  get #outputDir(): string {
    const opts = this.#browser?.options as
      | { outputDir?: string; rootDir?: string }
      | undefined
    return resolveAdapterOutputDir({
      userConfiguredDir: opts?.outputDir || opts?.rootDir
    })
  }

  /**
   * Stops the current screencast recorder, encodes collected frames into a
   * .webm file, and notifies the backend. Safe to call even if recording
   * never started or the CDP session died early.
   */
  async #finalizeScreencast(sessionId: string) {
    if (!this.#screencastRecorder) {
      return
    }
    // Skip ghost sessions: browser.reloadSession() creates a new session at
    // the end of a test run that has no steps — it captures at most a handful
    // of frames before teardown. Require at least 5 frames so we don't produce
    // empty videos for these ephemeral sessions.
    await finalizeScreencast({
      recorder: this.#screencastRecorder,
      sessionId,
      filenamePrefix: 'wdio-video',
      outputDir: this.#outputDir,
      minFrames: 5,
      captureFormat: this.#screencastOptions?.captureFormat,
      sendUpstream: (scope, data) =>
        this.#sessionCapturer.sendUpstream(scope, data),
      onLog: (level, message) => log[level](message)
    })
  }

  /**
   * Synchronous injection that blocks until complete
   */
  async #injectScriptSync(browser: WebdriverIO.Browser) {
    if (!browser.isBidi) {
      throw new SevereServiceError(
        `Can not set up devtools for session with id "${browser.sessionId}" because it doesn't support WebDriver Bidi`
      )
    }

    await this.#sessionCapturer.injectScript(getBrowserObject(browser))
    log.info('✓ Devtools preload script active')
  }

  async #ensureInjected(reason: string) {
    // Keep this for re-injection after context changes
    if (!this.#browser || this.#injecting) {
      return
    }
    try {
      this.#injecting = true
      const markerPresent = await this.#browser.execute(() => {
        return Boolean(
          (window as unknown as { __WDIO_DEVTOOLS_MARK?: unknown })
            .__WDIO_DEVTOOLS_MARK
        )
      })
      if (markerPresent) {
        return
      }
      await this.#sessionCapturer.injectScript(getBrowserObject(this.#browser))
    } catch (err) {
      log.warn(`[inject] failed (reason=${reason}): ${errorMessage(err)}`)
    } finally {
      this.#injecting = false
    }
  }
}
