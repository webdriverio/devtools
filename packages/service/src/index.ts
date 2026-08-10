/// <reference types="../../script/types.d.ts" />
import logger from '@wdio/logger'
import {
  attachTraceArtifact,
  beginInputDispatch,
  captureAndAttachScreenshot,
  errorMessage,
  finalizeTraceExport,
  lastRenderedScreenshot,
  mapCommandToAction,
  resolveAdapterOutputDir,
  stepMetadataUid,
  TestAttemptTracker,
  tracePolicyModeWarning,
  upsertRichestSnapshot,
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
import { TraceSliceTracker } from './trace-slices.js'
import {
  captureActionResult,
  captureActionSnapshot
} from './action-snapshot.js'
import type { ActionSnapshot, TestMetadataMap } from '@wdio/devtools-shared'
import { SevereServiceError } from 'webdriverio'
import type { Services, Capabilities, Options, Reporters } from '@wdio/types'
import type { WebDriverCommands } from '@wdio/protocols'

import { SessionCapturer } from './session.js'
import { TestReporter } from './reporter.js'
import { DevToolsAppLauncher } from './launcher.js'
import {
  chrome150InputRegressionWarning,
  getBrowserObject,
  isUserSpecFile
} from './utils.js'
import { ScreencastLifecycle } from './screencast-lifecycle.js'
import { attachBidiListeners } from './bidi-listeners.js'
import { parse } from 'stack-trace'
import { type ServiceOptions, TraceType } from './types.js'
import {
  CONTEXT_CHANGE_COMMANDS,
  INTERNAL_COMMANDS,
  LOCATOR_COMMANDS,
  PAGE_TRANSITION_COMMANDS
} from './constants.js'
import { isNativeMobile } from './mobile.js'
import { stampRunnerMetadata } from './wdio-runner-id.js'
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
  #options: ServiceOptions
  #actionSnapshots: ActionSnapshot[] = []
  #assertionTracker: AssertionTracker
  #screencast: ScreencastLifecycle
  #slices: TraceSliceTracker

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
    this.#screencast = new ScreencastLifecycle({
      options: this.#options,
      getBrowser: () => this.#browser,
      getCapturer: () => this.#sessionCapturer,
      getOutputDir: () => this.#outputDir,
      getTestUid: () => this.#currentTestUid,
      getTestStartWallTime: () => this.#currentTestStartWallTime,
      onArtifact: (artifact) => this.#artifacts.push(artifact),
      log: (level, message) => log[level](message)
    })
    this.#slices = new TraceSliceTracker({
      options: this.#options,
      getBrowser: () => this.#browser,
      getCapturer: () => this.#sessionCapturer,
      buildExportContext: (browser) => this.#traceContext(browser)
    })
  }

  /**
   * This is used to capture the command stack to ensure that we only capture
   * commands that are top-level user commands.
   */
  #commandStack: CommandFrame[] = []

  /** Closes the running command's screenshot-polling suppression window. Single
   *  slot because WDIO serialises commands per session; a concurrent pair (e.g.
   *  multiremote) closes the earlier window early, degrading to unguarded
   *  polling rather than stalling the recorder. */
  #closeInputWindow?: () => void

  /** Current test UID, set in beforeTest(), used by afterCommand() to tag commands. */
  #currentTestUid?: string
  /** Current Cucumber step UID, set in beforeStep(), used by afterCommand() to
   *  nest commands under the step in the trace group tree (C2). */
  #currentStepUid?: string
  /** Per-scenario step counter for stable, collision-free step uids. */
  #currentStepIndex = 0
  /** True when @wdio/allure-reporter is in the WDIO config (detected in
   *  beforeSession) — auto-enables the artifacts manifest even if the option
   *  isn't set, since session/spec-scoped Allure attach reads it. */
  #allureReporterConfigured = false

  /** Wall-clock ms at the current test's start, set in beforeTest/beforeScenario;
   *  the lower bound of that test's video frame window (per-test slicing). */
  #currentTestStartWallTime = 0

  /** Map of testUid → metadata for trace group events and per-spec partitioning. */
  #testMetadata: TestMetadataMap = new Map()

  /** Per-test attempt counter. specFileRetries spawns a fresh worker (hence a
   *  fresh instance) per retry, so this only reflects same-process retries
   *  (Mocha this.retries(n)); cross-worker attempts rely on the WDIO result. */
  #attemptTracker = new TestAttemptTracker()

  /** Every trace/video artifact seen this run (retained or not), for the
   *  end-of-run artifacts manifest. Populated via the context's onArtifact. */
  #artifacts: TraceArtifact[] = []

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
      screencastFrames: this.#screencast.filmstripFramesForExport(),
      sessionId: browser.sessionId,
      capabilities: browser.capabilities,
      testMetadata: this.#testMetadata,
      attemptInfoAvailable: true,
      outcomes: this.#attemptTracker,
      ranges: this.#slices.ranges,
      flushed: this.#slices.flushed,
      resolveOutputDir: () => this.#outputDir,
      log: (level, msg) => log[level](msg),
      emitManifest:
        this.#options.emitArtifactsManifest ?? this.#allureReporterConfigured,
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

    const versionWarning = chrome150InputRegressionWarning(browser.capabilities)
    if (versionWarning) {
      log.warn(versionWarning)
    }

    /**
     * create a new session capturer instance with the devtools options
     */
    const wdioCaps = caps as Capabilities.W3CCapabilities & {
      'wdio:devtoolsOptions'?: ServiceOptions
    }
    this.#sessionCapturer = new SessionCapturer(
      wdioCaps['wdio:devtoolsOptions']
    )
    stampRunnerMetadata(this.#sessionCapturer, browser, this.captureType)

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

    // WDIO has already subscribed the BiDi events by now, so attaching here
    // issues no mid-run protocol traffic and misses no early events.
    if (browser.isBidi) {
      attachBidiListeners(browser, this.#sessionCapturer)
    }

    await this.#screencast.start(browser)

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
            capabilities: browser.capabilities as Capabilities.W3CCapabilities,
            runner: this.#sessionCapturer.metadata?.runner
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
    browser.addCommand(
      'getSnapshot',
      async (options?: { inViewportOnly?: boolean }) => {
        try {
          const { getSnapshot } = await import('@wdio/elements')
          return await getSnapshot(browser, options ?? { inViewportOnly: true })
        } catch (err) {
          log.warn(`getSnapshot failed: ${errorMessage(err)}`)
          return { text: '[Snapshot unavailable]', elements: {} }
        }
      }
    )
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
      // Detect the Allure reporter (before we append our own) so the artifacts
      // manifest auto-enables for session/spec-scoped Allure attach.
      this.#allureReporterConfigured = (config.reporters || []).some((r) => {
        const name = Array.isArray(r) ? r[0] : r
        return typeof name === 'string' && name.includes('allure')
      })
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

    this.#slices.recordBoundary(featureFile, uid)

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

    this.#slices.recordBoundary(test?.file, uid)

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
    const uid = stepMetadataUid(this.#currentTestUid, this.#currentStepIndex)
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
      const artifact = await this.#slices.flushTest(uid)
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
    await this.#screencast.attachTestVideo({
      testUid: uid,
      attempt,
      outcomes: uid ? this.#attemptTracker.forTest(uid, attempt) : [],
      attach
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
    // Drain the collector one final time while the session is still alive, so the
    // DOM the LAST command produced is recorded — a closing navigation (e.g. a
    // logout landing back on the login page) fires no subsequent beforeCommand,
    // which is where every other drain happens, so its destination DOM would
    // otherwise never be captured before teardown. forceAnchor: the destination's
    // async initial anchor may not have run yet, so anchor it synchronously here.
    await this.#sessionCapturer.captureTrace(this.#browser, true)
    const snap = await captureActionSnapshot(
      this.#browser,
      '__final__',
      this.#lastActionTimestamp()
    )
    if (snap) {
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
    // No command is in flight after a reset; without this a window stranded by a
    // spec boundary would keep dropping frames until its bound expired.
    this.#closeInputWindow?.()
    this.#closeInputWindow = undefined
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
    // Suppress screenshot polling for the duration of an input-dispatching
    // command: a poll landing inside chromedriver's click, between computing the
    // element's coordinates and dispatching at them, makes the click report
    // success while activating nothing. Opened before the pre-action probes below
    // so it spans the whole command.
    this.#closeInputWindow?.()
    this.#closeInputWindow = beginInputDispatch(command)
    // `url` is the one start-of-recording signal every runner reaches (Mocha,
    // Jasmine, Cucumber, standalone), so the video's start marker hangs off it.
    if (command === 'url') {
      this.#screencast.markStart()
      this.#sessionCapturer.sendUpstream('metadata', { url: args[0] })
    }
    // Smart stack filtering to detect top-level user commands. This bookkeeping
    // is synchronous and must settle BEFORE any await below, because afterCommand
    // pops exactly what beforeCommand pushed — a stack push stranded behind an
    // await would let a same-tick afterCommand miss the frame.
    Error.stackTraceLimit = 20
    const stack = parse(new Error('')).reverse()
    const source = stack.find((frame) => isUserSpecFile(frame.getFileName()))
    // A matcher's value-read (getText/isExisting) is captured normally like any
    // command; afterAssertion later folds it into the expect.<matcher> row (see
    // coalesceAssertionIntoLastRead) — no suppression window needed here.
    const topLevelUserCommand = source && this.#commandStack.length === 0
    if (topLevelUserCommand) {
      this.#pushTopLevelCommandFrame(
        command,
        resolveCallSourceFromFrame(source)
      )
    }
    // Flush the outgoing page's buffered mutations (e.g. field edits from prior
    // fills — value/checked changes fire no page transition) BEFORE a navigating
    // command discards its collector, else the replay shows empty inputs. Runs
    // in live mode too: navigation drops the old document's collector, so the
    // post-navigation afterCommand drain would hit the fresh page and lose them.
    if (PAGE_TRANSITION_COMMANDS.includes(command)) {
      await this.#sessionCapturer.captureTrace(this.#browser)
    }
    // Pre-action capture: state BEFORE this action executes. Stamped at the
    // previous action's end time (or 0 for the first). Trace mode only.
    if (
      topLevelUserCommand &&
      this.#options.mode === 'trace' &&
      this.#browser &&
      mapCommandToAction(command) &&
      !INTERNAL_COMMANDS.includes(command)
    ) {
      const snap = await captureActionSnapshot(
        this.#browser,
        command,
        this.#lastActionTimestamp()
      )
      if (snap) {
        upsertRichestSnapshot(this.#actionSnapshots, snap)
      }
      // Tag the current document so the post-action capture can tell whether
      // this action navigated (a new document drops the tag).
      await this.#markDocument()
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
    this.#closeInputWindow?.()
    this.#closeInputWindow = undefined

    // Record every element resolution, even those below the top-level command
    // boundary — an `expect($('#flash'))` resolves its element inside the
    // matcher, so this is the only place the assertion's target selector is
    // observable (see SessionCapturer.noteResolvedSelector).
    if (
      LOCATOR_COMMANDS.includes(command as string) &&
      typeof args[0] === 'string' &&
      args[0]
    ) {
      this.#sessionCapturer.noteResolvedSelector(args[0])
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
        } else {
          await this.#drainAfterLiveCommand(command)
        }
        return captured
      }
    }

    // Re-inject AFTER context-changing commands complete so new documents/frames are instrumented
    if (CONTEXT_CHANGE_COMMANDS.includes(command)) {
      void this.#ensureInjected(`context-change:${command}`)
    }
  }

  /** Live mode has no per-action DOM snapshot (that's trace mode), so the
   *  dashboard's replay is only as fresh as the last drain. Field edits fire no
   *  page transition, so without this every action between two navigations
   *  replays the page as it looked at load — an un-filled form after setValue.
   *  Page-transition commands already drain inside the capturer, and resolving
   *  a locator can't change the DOM — skipping both keeps the added round trips
   *  to the commands that can actually move the page (which matters: capture
   *  traffic is what triggers the Chrome 150 headless input regression). */
  async #drainAfterLiveCommand(command: keyof WebDriverCommands) {
    if (
      !this.#browser ||
      isNativeMobile(this.#browser) ||
      PAGE_TRANSITION_COMMANDS.includes(command) ||
      LOCATOR_COMMANDS.includes(command)
    ) {
      return
    }
    await this.#sessionCapturer.captureTrace(this.#browser)
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
    await this.#screencast.finalize(this.#browser.sessionId)

    await finalizeTraceExport(this.#traceContext(this.#browser))

    // Clean up console patching
    this.#sessionCapturer.cleanup()
  }

  /**
   * Called by WebdriverIO after browser.reloadSession() completes. The old
   * session (and its CDP connection) is destroyed at this point, so both the
   * page instrumentation and the screencast have to be re-armed for the new one.
   */
  async onReload(oldSessionId: string, _newSessionId: string) {
    // reloadSession starts a fresh session with no preload script (BiDi preload
    // scripts are per-session), so DOM-mutation capture would silently stop
    // after the first session — every post-reload scenario would replay the
    // prior session's last DOM. Re-arm capture for the new session here,
    // independent of screencast, so it runs before that early-returns.
    this.#sessionCapturer.resetScriptInjection()
    await this.#ensureInjected('reloadSession')

    await this.#screencast.handleReload(oldSessionId)
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
      await this.#sessionCapturer.injectScript(getBrowserObject(this.#browser))
    } catch (err) {
      // Not recoverable here, and silence would mean losing DOM capture for the
      // rest of the session with no symptom other than a stale replay. The
      // per-drain recovery in core is the safety net for the current document.
      log.error(`[inject] failed (reason=${reason}): ${errorMessage(err)}`)
    } finally {
      this.#injecting = false
    }
  }
}
