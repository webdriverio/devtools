/// <reference types="../../script/types.d.ts" />
import logger from '@wdio/logger'
import {
  attachTraceArtifact,
  captureAndAttachScreenshot,
  captureAndAttachVideo,
  errorMessage,
  finalizeScreencast,
  finalizeTraceExport,
  lastRenderedScreenshot,
  mapCommandToAction,
  recordSliceBoundary,
  resolveAdapterOutputDir,
  TestAttemptTracker,
  tracePolicyModeWarning,
  type SpecRange,
  type TraceArtifact,
  type TraceExportContext
} from '@wdio/devtools-core'
import { getAllureSink } from './allure.js'
import { wireAssertCapture, type ExpectAssertion } from './assert-capture.js'
import { AssertionTracker } from './assertion-tracker.js'
import {
  cucumberScenarioUid,
  isFailedResult,
  resolveTestAttempt,
  stampTestState,
  testMetadataUid,
  type TestOutcomeResult
} from './test-metadata.js'
import { resolveCallSourceFromFrame } from './call-source.js'
import { flushPrevSlice, flushTestSlice } from './trace-slices.js'
import {
  captureActionResult,
  captureActionSnapshot
} from './action-snapshot.js'
import {
  dedupeSnapshotsByTimestamp,
  upsertRichestSnapshot
} from './snapshot-dedupe.js'
import type {
  ActionSnapshot,
  ScreencastFrame,
  TestMetadataMap
} from '@wdio/devtools-shared'
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
import {
  CONTEXT_CHANGE_COMMANDS,
  INTERNAL_COMMANDS,
  PAGE_TRANSITION_COMMANDS
} from './constants.js'
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
  #assertionTracker: AssertionTracker

  constructor(serviceOptions: ServiceOptions = {}) {
    this.#options = serviceOptions
    this.#assertionTracker = new AssertionTracker({
      getCapturer: () => this.#sessionCapturer,
      getBrowser: () => this.#browser,
      getTestUid: () => this.#currentTestUid,
      getStepUid: () => this.#currentStepUid,
      options: this.#options,
      actionSnapshots: this.#actionSnapshots
    })
    const policyWarning = tracePolicyModeWarning(
      serviceOptions.tracePolicy,
      serviceOptions.mode
    )
    if (policyWarning) {
      log.warn(policyWarning)
    }
    if (serviceOptions.mode === 'trace' && serviceOptions.screencast?.enabled) {
      log.warn(
        'trace mode: `screencast.enabled` is ignored — use `video` to record; ' +
          'the tuning fields (quality/interval) still apply'
      )
    }
    // Tuning is kept for both modes; whether we actually record is decided by
    // #shouldRecordScreencast (screencast.enabled in live, `video` in trace).
    this.#screencastOptions = serviceOptions.screencast
  }

  /**
   * This is used to capture the command stack to ensure that we only capture
   * commands that are top-level user commands.
   */
  #commandStack: CommandFrame[] = []

  /** Current test UID, set in beforeTest(), used by afterCommand() to tag commands. */
  #currentTestUid?: string
  /** Current Cucumber step UID, set in beforeStep(), used by afterCommand() to
   *  nest commands under the step in the trace group tree (C2). */
  #currentStepUid?: string
  /** Per-scenario step counter for stable, collision-free step uids. */
  #currentStepIndex = 0

  /** Wall-clock ms at the current test's start, set in beforeTest/beforeScenario;
   *  the lower bound of that test's video frame window (per-test slicing). */
  #currentTestStartWallTime = 0

  /** Recorder frames snapshotted in onReload before reloadSession replaces the
   *  recorder — so the ending test's per-test video can still be sliced in
   *  afterScenario (which runs AFTER the cucumber After hook's reloadSession). */
  #pendingVideoFrames?: {
    testUid: string | undefined
    startWallTime: number
    frames: ScreencastFrame[]
  }

  /** Filmstrip frames accumulated across reloadSession() boundaries — the
   *  recorder's buffer resets per session, so this persists earlier sessions'
   *  frames (like #actionSnapshots) and is concatenated with the live recorder's
   *  frames at export, then windowed per slice in core. Filmstrip mode only. */
  #filmstripFrames: ScreencastFrame[] = []

  /** Map of testUid → metadata for trace group events and per-spec partitioning. */
  #testMetadata: TestMetadataMap = new Map()

  /** Per-test attempt counter. specFileRetries spawns a fresh worker (hence a
   *  fresh instance) per retry, so this only reflects same-process retries
   *  (Mocha this.retries(n)); cross-worker attempts rely on the WDIO result. */
  #attemptTracker = new TestAttemptTracker()

  /** Index ranges into the session capturer's flat arrays, one per spec file. */
  #specRanges: SpecRange[] = []

  /** Set of spec files already flushed to disk. */
  #flushedSpecs = new Set<string>()

  /** Every trace/video artifact seen this run (retained or not), for the
   *  end-of-run artifacts manifest. Populated via the context's onArtifact. */
  #artifacts: TraceArtifact[] = []

  /** Build the boundary context for recordSliceBoundary — the same shape is
   *  needed in both beforeTest and beforeScenario. */
  get #boundaryContext() {
    return {
      specRanges: this.#specRanges,
      flushedSpecs: this.#flushedSpecs,
      capturer: this.#sessionCapturer
    }
  }

  /** Record a trace-slice boundary. `spec` slices per file; `test` per test
   *  (retries keyed per attempt by core); `session` records nothing. The
   *  previous-slice flush fires for `spec`; `test` slices eager-flush at their
   *  own test end (see #eagerFlushTestSlice) so this is only a missed-slice net. */
  #recordBoundary(specFile: string | undefined, testUid?: string): void {
    if (!specFile) {
      return
    }
    const prevRange = recordSliceBoundary(
      this.#boundaryContext,
      this.#options.traceGranularity,
      specFile,
      testUid
    )
    if (prevRange && this.#browser) {
      flushPrevSlice(this.#traceContext(this.#browser), prevRange)
    }
  }

  /** Record a screencast this session? Live mode: `screencast.enabled`. Trace
   *  mode: a non-`off` `video` policy (frames sliced per test at flush) or
   *  `filmstrip` (dense frames written into the trace itself). */
  #shouldRecordScreencast(): boolean {
    if (this.#options.mode === 'trace') {
      return (
        (!!this.#options.video && this.#options.video !== 'off') ||
        !!this.#options.filmstrip
      )
    }
    return !!this.#screencastOptions?.enabled
  }

  /** Whole-run filmstrip frames for the export context: earlier sessions'
   *  accumulated frames plus the live recorder's, or undefined when filmstrip
   *  is off (so the trace stays byte-stable with today's output). */
  #filmstripFramesForExport(): ScreencastFrame[] | undefined {
    if (!this.#options.filmstrip) {
      return undefined
    }
    return [
      ...this.#filmstripFrames,
      ...(this.#screencastRecorder?.frames ?? [])
    ]
  }

  /** Eager per-test flush at test end (test granularity only), run after the
   *  outcome is stamped so this attempt's metadata is written before a retry
   *  overwrites it; the end-of-run finalizer then dedupes it via the key set. */
  async #eagerFlushTestSlice(
    testUid: string
  ): Promise<TraceArtifact | undefined> {
    if (
      this.#options.traceGranularity !== 'test' ||
      this.#options.mode !== 'trace' ||
      !this.#browser
    ) {
      return undefined
    }
    return flushTestSlice(
      this.#traceContext(this.#browser),
      this.#specRanges,
      testUid
    )
  }

  /** Assemble the framework-agnostic trace-export context from this service's
   *  state. Output dir ignores the spec range — WDIO writes next to config. */
  #traceContext(browser: WebdriverIO.Browser): TraceExportContext {
    return {
      mode: this.#options.mode,
      policy: this.#options.tracePolicy,
      granularity: this.#options.traceGranularity,
      format: this.#options.traceFormat,
      capturer: this.#sessionCapturer,
      actionSnapshots: this.#actionSnapshots,
      screencastFrames: this.#filmstripFramesForExport(),
      sessionId: browser.sessionId,
      capabilities: browser.capabilities,
      testMetadata: this.#testMetadata,
      attemptInfoAvailable: true,
      outcomes: this.#attemptTracker,
      ranges: this.#specRanges,
      flushed: this.#flushedSpecs,
      resolveOutputDir: () => this.#outputDir,
      prepareSnapshots: dedupeSnapshotsByTimestamp,
      log: (level, msg) => log[level](msg),
      emitManifest: true,
      collectedArtifacts: this.#artifacts,
      onArtifact: (a) => this.#artifacts.push(a)
    }
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

    if (this.#options.captureAssertions !== false) {
      wireAssertCapture(
        () => this.#sessionCapturer,
        () => this.#currentTestUid
      )
    }

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
     * Start screencast recording when enabled — `screencast.enabled` in live
     * mode, or a non-`off` `video` policy (per-test slicing at flush) or
     * `filmstrip` (dense frames into the trace) in trace mode. Failures are
     * non-fatal — logged, session continues.
     */
    if (this.#shouldRecordScreencast()) {
      this.#screencastRecorder = new ScreencastRecorder(
        this.#screencastOptions ?? {}
      )
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
      try {
        const { getSnapshot } = await import('@wdio/elements')
        return await getSnapshot(browser, options ?? { inViewportOnly: true })
      } catch (err) {
        log.warn(`getSnapshot failed: ${errorMessage(err)}`)
        return { text: '[Snapshot unavailable]', elements: {} }
      }
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

  /** Cucumber hook: records feature-file boundaries and tags commands with a stable testUid. */
  beforeScenario(world?: {
    pickle?: { uri?: string; name?: string; astNodeIds?: readonly string[] }
  }) {
    this.resetStack()
    this.#currentTestStartWallTime = Date.now()
    this.#currentStepIndex = 0
    this.#currentStepUid = undefined

    const featureFile = world?.pickle?.uri
    const scenarioName = world?.pickle?.name
    // Derived before recording the boundary so `test` granularity keys the
    // slice on the same uid the metadata map uses.
    const uid =
      featureFile && scenarioName
        ? cucumberScenarioUid(
            featureFile,
            scenarioName,
            world?.pickle?.astNodeIds
          )
        : undefined

    this.#recordBoundary(featureFile, uid)

    // ── Test identity for command tagging ──
    if (uid && scenarioName && featureFile) {
      this.#currentTestUid = uid
      this.#attemptTracker.recordStart(uid, featureFile)
      this.#testMetadata.set(uid, {
        title: scenarioName,
        specFile: featureFile
      })
    }
  }

  /** Mocha/Jasmine hook: the beforeScenario equivalent for file-based specs. */
  beforeTest(test?: { file?: string; title?: string; fullTitle?: string }) {
    this.resetStack()
    this.#currentTestStartWallTime = Date.now()

    // Track test identity for command tagging. Generate a stable UID
    // from file + title so commands can be partitioned across reruns.
    // WDIO's Test type always provides `fullTitle`; `title` is a
    // fallback for non-WDIO frameworks. Derived before the boundary so
    // `test` granularity keys the slice on the metadata-map uid.
    const testTitle = test?.fullTitle || test?.title
    const uid = testTitle ? testMetadataUid(test?.file, testTitle) : undefined

    this.#recordBoundary(test?.file, uid)

    if (uid && testTitle) {
      this.#currentTestUid = uid
      this.#attemptTracker.recordStart(uid, test?.file)
      this.#testMetadata.set(uid, {
        title: testTitle,
        specFile: test?.file ?? ''
      })
    }
  }

  // Tag the scenario's commands with a stable per-step uid so the trace nests
  // them under the step (Feature→Scenario→Step). The uid combines the scenario
  // uid with a per-scenario counter, so repeated step text can't collide.
  beforeStep(step?: { text?: string; keyword?: string }) {
    if (!this.#currentTestUid) {
      return
    }
    this.#currentStepIndex += 1
    const uid = `${this.#currentTestUid}:step:${this.#currentStepIndex}`
    const title =
      [step?.keyword, step?.text].filter(Boolean).join('').trim() ||
      `Step ${this.#currentStepIndex}`
    this.#currentStepUid = uid
    this.#testMetadata.set(uid, {
      title,
      specFile: this.#testMetadata.get(this.#currentTestUid)?.specFile ?? ''
    })
  }

  // afterStep fires right after each step, so the failing assertion lands next
  // to the step's actions rather than after reloadSession at scenario end.
  afterStep(
    _step?: unknown,
    _scenario?: unknown,
    result?: { error?: unknown }
  ) {
    this.#currentStepUid = undefined
    this.#assertionTracker.handleOutcome(result?.error)
  }

  /** Stamp final state + the resolved 0-based attempt onto the test's metadata
   *  entry, taking the max of the tracker count and WDIO's retry field. */
  #stampOutcome(uid: string, result?: TestOutcomeResult): void {
    const fallback = this.#attemptTracker.attemptFor(uid) ?? 0
    const attempt = resolveTestAttempt(result, fallback)
    stampTestState(this.#testMetadata, uid, result, attempt)
    // Feed the per-attempt ledger so session/spec retention sees this attempt's
    // real outcome, not just the final state that overwrites #testMetadata.
    this.#attemptTracker.recordOutcome(
      uid,
      this.#testMetadata.get(uid)?.state,
      attempt
    )
  }

  async afterScenario(
    world?: {
      pickle?: { uri?: string; name?: string; astNodeIds?: readonly string[] }
    },
    result?: TestOutcomeResult
  ) {
    const { uri, name, astNodeIds } = world?.pickle ?? {}
    const uid =
      uri && name ? cucumberScenarioUid(uri, name, astNodeIds) : undefined
    if (uid) {
      this.#stampOutcome(uid, result)
    }
    await this.#finalizePerScenario()
    await this.#emitTestArtifacts(uid, isFailedResult(result))
  }

  async afterTest(
    test?: { file?: string; title?: string; fullTitle?: string },
    _context?: unknown,
    result?: TestOutcomeResult
  ) {
    this.#assertionTracker.handleOutcome(result?.error)
    const testTitle = test?.fullTitle || test?.title
    const uid = testTitle ? testMetadataUid(test?.file, testTitle) : undefined
    if (uid) {
      this.#stampOutcome(uid, result)
    }
    await this.#finalizePerScenario()
    await this.#emitTestArtifacts(uid, isFailedResult(result))
  }

  /** At test end, while the per-test hook is still open: eager-flush this test's
   *  slice (so it captures the final snapshot + stamped outcome) and attach the
   *  retained trace to Allure, then capture the per-test screenshot per policy
   *  and attach it too. Each part no-ops when its feature is off. */
  async #emitTestArtifacts(
    uid: string | undefined,
    failed: boolean
  ): Promise<void> {
    const attach = await getAllureSink()
    const onLog = (level: 'info' | 'warn', msg: string) => log[level](msg)
    if (uid) {
      const artifact = await this.#eagerFlushTestSlice(uid)
      if (artifact) {
        await attachTraceArtifact(artifact, attach, onLog)
      }
    }
    await captureAndAttachScreenshot({
      mode: this.#options.mode,
      granularity: this.#options.traceGranularity,
      policy: this.#options.screenshot,
      failed,
      screenshotBase64: lastRenderedScreenshot(
        this.#actionSnapshots,
        this.#currentTestStartWallTime
      ),
      sessionId: this.#browser?.sessionId,
      outputDir: this.#outputDir,
      testUid: uid,
      attach,
      onArtifact: (a) => this.#artifacts.push(a)
    })
    // Authoritative attempt for this test (stamped into metadata by
    // #stampOutcome, which ran just before this). Scopes retention + the video
    // filename to this attempt so retries don't overwrite each other.
    const attempt = uid ? this.#testMetadata.get(uid)?.attempt : undefined
    // Prefer frames snapshotted in onReload (reloadSession tears the recorder
    // down before this hook); fall back to the live recorder otherwise.
    const pending =
      this.#pendingVideoFrames?.testUid === uid
        ? this.#pendingVideoFrames
        : undefined
    this.#pendingVideoFrames = undefined
    await captureAndAttachVideo({
      mode: this.#options.mode,
      granularity: this.#options.traceGranularity,
      policy: this.#options.video,
      frames: pending?.frames ?? this.#screencastRecorder?.frames,
      startWallTime: pending?.startWallTime ?? this.#currentTestStartWallTime,
      outcomes: uid ? this.#attemptTracker.forTest(uid, attempt) : [],
      attempt,
      outputDir: this.#outputDir,
      testUid: uid,
      sessionId: this.#browser?.sessionId,
      captureFormat: this.#screencastOptions?.captureFormat,
      attach,
      onArtifact: (a) => this.#artifacts.push(a),
      onLog
    })
  }

  /** expect-webdriverio matcher hooks — delegated to the assertion tracker. */
  beforeAssertion(params: {
    matcherName: string
    expectedValue?: unknown
  }): void {
    this.#assertionTracker.beforeAssertion(params)
  }

  afterAssertion(params: ExpectAssertion): Promise<void> {
    return this.#assertionTracker.afterAssertion(params)
  }

  async #finalizePerScenario() {
    if (this.#options.mode !== 'trace' || !this.#browser) {
      return
    }
    const stamp = this.#lastActionTimestamp()
    const snap = await captureActionSnapshot(this.#browser, '__final__')
    if (snap) {
      snap.timestamp = stamp
      // The last action's post-capture shares this timestamp and resources are
      // named by timestamp, so keep only the richer screenshot — a blank
      // end-of-scenario frame must not clobber the action's real result.
      upsertRichestSnapshot(this.#actionSnapshots, snap)
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

  private resetStack() {
    this.#commandStack = []
    this.#assertionTracker.reset()
    this.#sessionCapturer.resetLastSelector()
    this.#sessionCapturer.resetRetryTracker()
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
    // Flush the outgoing page's buffered mutations (e.g. field edits from prior
    // fills — value/checked changes fire no page transition) BEFORE a navigating
    // command discards its collector, else the replay shows empty inputs.
    if (
      this.#options.mode === 'trace' &&
      PAGE_TRANSITION_COMMANDS.includes(command)
    ) {
      await this.#sessionCapturer.captureTrace(this.#browser)
    }
    // Smart stack filtering to detect top-level user commands.
    Error.stackTraceLimit = 20
    const stack = parse(new Error('')).reverse()
    const source = stack.find((frame) => isUserSpecFile(frame.getFileName()))
    // A matcher's value-read (getText/isExisting) is captured normally like any
    // command; afterAssertion later folds it into the expect.<matcher> row (see
    // coalesceAssertionIntoLastRead) — no suppression window needed here.
    if (source && this.#commandStack.length === 0) {
      this.#pushTopLevelCommandFrame(
        command,
        resolveCallSourceFromFrame(source)
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
          this.#currentTestUid,
          this.#currentStepUid
        )
        if (this.#options.mode === 'trace') {
          await captureActionResult(
            this.#browser,
            command,
            this.#actionSnapshots,
            () => this.#lastActionTimestamp()
          )
        }
        return captured
      }
    }

    // Re-inject AFTER context-changing commands complete so new documents/frames are instrumented
    if (CONTEXT_CHANGE_COMMANDS.includes(command)) {
      void this.#ensureInjected(`context-change:${command}`)
    }
  }

  /**
   * after hook is triggered at the end of every worker session, therefore
   * we can use it to write all trace information to a file. `trace` mode
   * writes the shareable trace.zip (opened via `pnpm show-trace`); `live`
   * mode streams to the dashboard over WS and persists nothing to disk.
   */
  async after() {
    if (!this.#browser) {
      return
    }

    // Stop and encode the screencast for the current session.
    await this.#finalizeScreencast(this.#browser.sessionId)

    await finalizeTraceExport(this.#traceContext(this.#browser))

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
    // reloadSession starts a fresh session with no preload script (BiDi preload
    // scripts are per-session), so DOM-mutation capture would silently stop
    // after the first session — every post-reload scenario would replay the
    // prior session's last DOM. Re-arm capture for the new session here,
    // independent of screencast, so it runs before the early-return below.
    this.#sessionCapturer.resetScriptInjection()
    await this.#ensureInjected('reloadSession')

    if (!this.#shouldRecordScreencast() || !this.#browser) {
      return
    }

    // Trace mode: the ending test's afterScenario runs AFTER this reload (a
    // cucumber `After(() => reloadSession())` is WDIO boilerplate), by which
    // point the recorder below has replaced these frames. Snapshot them now,
    // keyed to the ending test, so afterScenario can still slice its video.
    if (this.#options.mode === 'trace' && this.#screencastRecorder) {
      const frames = [...this.#screencastRecorder.frames]
      this.#pendingVideoFrames = {
        testUid: this.#currentTestUid,
        startWallTime: this.#currentTestStartWallTime,
        frames
      }
      // Persist for the filmstrip too — the recorder below resets the buffer,
      // so a session/spec trace spanning this reload keeps its earlier frames.
      if (this.#options.filmstrip) {
        this.#filmstripFrames.push(...frames)
      }
    }

    // Finalize the recording from the old session (CDP is already gone, so
    // stop() will fail gracefully and we encode whatever frames arrived).
    await this.#finalizeScreencast(oldSessionId)

    // Start a new recorder for the new session.
    this.#screencastRecorder = new ScreencastRecorder(
      this.#screencastOptions ?? {}
    )
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
    // Trace mode: the video is emitted per-test (sliced in #emitTestArtifacts),
    // and there's no dashboard to receive a session recording — so just stop the
    // recorder to release resources; never encode an orphan session-wide webm.
    if (this.#options.mode === 'trace') {
      await this.#screencastRecorder.stop()
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
