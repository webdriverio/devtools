// @wdio/selenium-devtools — runner-agnostic Selenium WebDriver adapter.
// Side-effect import that patches selenium-webdriver and starts the backend.

// MUST be the first import — see setupConsole.ts.
import './setupConsole.js'
import * as path from 'node:path'
import logger from '@wdio/logger'
import { startDetachedBackend } from './helpers/detachedBackend.js'
import { openDashboard } from './helpers/dashboardLauncher.js'
import { buildDriverMetadata } from './helpers/driverMetadata.js'
import { finalizeScreencast } from './helpers/finalizeScreencast.js'
import {
  enrichFindResult,
  captureNavigationTrace
} from './helpers/commandPostActions.js'
import {
  gracefulShutdown,
  registerProcessHooks
} from './helpers/processHooks.js'
import { patchSelenium } from './driverPatcher.js'
import {
  ensureBidiCapability,
  ensureHeadlessChrome,
  attachBidiHandlers,
  buildBidiSinks
} from './bidi.js'
import { SessionCapturer } from './session.js'
import { TestReporter } from './reporter.js'
import { SuiteManager } from './helpers/suiteManager.js'
import { TestManager } from './helpers/testManager.js'
import { RerunManager } from './rerunManager.js'
import { ScreencastRecorder } from './screencast.js'
import {
  detectOwnVersion,
  detectRunner,
  detectSeleniumVersion
} from './helpers/runtime.js'
import { findFreePort, getCallSourceFromStack } from './helpers/utils.js'
import { tryRegisterRunnerHooks } from './runnerHooks.js'
import { patchNodeAssert } from './assertPatcher.js'
import {
  DEFAULTS,
  REUSE_ENV,
  SCREENCAST_DEFAULTS,
  TIMING,
  TEST_STATE,
  NAVIGATION_COMMANDS
} from './constants.js'
import {
  type CapturedCommand,
  type CommandLog,
  type DevToolsOptions,
  type ScreencastOptions,
  type SeleniumDriverLike,
  type TestStats
} from './types.js'

const log = logger('@wdio/selenium-devtools')

const PLUGIN_VERSION = detectOwnVersion()
const RUNNER = detectRunner()
const SELENIUM_VERSION = detectSeleniumVersion() ?? 'unknown'

log.info(`@wdio/selenium-devtools v${PLUGIN_VERSION} loaded`)
log.info(`Workspace: ${process.cwd()}`)
log.info(`Detected runner: ${RUNNER}`)
log.info(`Detected selenium-webdriver: v${SELENIUM_VERSION}`)

class SeleniumDevToolsPlugin {
  #options: Required<Omit<DevToolsOptions, 'rerunCommand' | 'screencast'>> & {
    rerunCommand?: string
    headless: boolean
  }
  #sessionCapturer?: SessionCapturer
  #testReporter?: TestReporter
  #suiteManager?: SuiteManager
  #testManager?: TestManager
  #rerunManager: RerunManager
  #backendStarted = false
  #backendStartPromise?: Promise<void>
  #driver?: SeleniumDriverLike
  #scriptInjected = false
  #isReuse = false
  // Coalesce internal retries: same {command,args,src} replaces prior entry.
  #lastCapturedSig: string | null = null
  #lastCapturedId: number | null = null
  #screencast?: ScreencastRecorder
  #screencastOptions: ScreencastOptions
  #sessionId?: string
  #uiUrlOpened = false
  #testFileDir?: string
  #keepAliveTimer?: ReturnType<typeof setInterval>
  #uiReadyPromise?: Promise<void>
  // First it() body fires before onDriverCreated's async setup completes —
  // buffer startTest/endTest until testManager exists.
  #pendingTestActions: Array<
    | {
        kind: 'start'
        name: string
        meta: { file?: string; callSource?: string }
        suiteName?: string
        suiteCallSource?: string
      }
    | { kind: 'end'; state: TestStats['state'] }
  > = []
  // Cucumber Before fires before the driver-build Before — stash and replay.
  #pendingScenario: {
    name: string
    file?: string
    callSource?: string
    featureName?: string
    featureCallSource?: string
  } | null = null

  constructor(options: DevToolsOptions = {}) {
    this.#options = {
      port: options.port ?? 3000,
      hostname: options.hostname ?? 'localhost',
      // Default true to match @wdio/devtools-service and @wdio/nightwatch-devtools.
      openUi: options.openUi ?? true,
      captureScreenshots: options.captureScreenshots ?? true,
      rerunCommand: options.rerunCommand,
      headless: options.headless ?? false
    }
    this.#rerunManager = new RerunManager(RUNNER)
    if (options.rerunCommand) {
      this.#rerunManager.configure(options.rerunCommand)
    }
    this.#screencastOptions = {
      ...SCREENCAST_DEFAULTS,
      ...(options.screencast ?? {})
    }
    this.#detectReuseMode()
  }

  #configSummaryLogged = false

  #logConfigSummary() {
    if (this.#configSummaryLogged) {
      return
    }
    this.#configSummaryLogged = true
    const screencast = this.#screencastOptions.enabled
      ? `${this.#screencastOptions.maxWidth}x${this.#screencastOptions.maxHeight}@q${this.#screencastOptions.quality}`
      : 'off'
    const rerun = this.#options.rerunCommand
      ? 'custom'
      : this.#rerunManager.rerunTemplate
        ? 'auto'
        : 'launch-only'
    log.info(
      `Configuration: openUi=${this.#options.openUi}, headless=${this.#options.headless}, ` +
        `screencast=${screencast}, captureScreenshots=${this.#options.captureScreenshots}, ` +
        `rerun=${rerun}`
    )
  }

  #detectReuseMode() {
    if (
      process.env[REUSE_ENV.REUSE] === '1' &&
      process.env[REUSE_ENV.HOST] &&
      process.env[REUSE_ENV.PORT]
    ) {
      this.#options.hostname = process.env[REUSE_ENV.HOST]!
      this.#options.port = Number(process.env[REUSE_ENV.PORT])
      this.#isReuse = true
      log.info(
        `♻  Reusing DevTools backend at ${this.#options.hostname}:${this.#options.port}`
      )
    }
  }

  async ensureBackendStarted(): Promise<void> {
    if (this.#backendStarted) {
      return
    }
    if (this.#backendStartPromise) {
      return this.#backendStartPromise
    }
    this.#backendStartPromise = (async () => {
      try {
        this.#logConfigSummary()
        if (!this.#isReuse) {
          this.#options.port = await findFreePort(
            this.#options.port,
            this.#options.hostname
          )
          log.info('🚀 Starting DevTools backend...')
          const { port } = await startDetachedBackend({
            port: this.#options.port,
            hostname: this.#options.hostname
          })
          this.#options.port = port
          log.info(
            `✓ Backend ready — DevTools UI: http://${this.#options.hostname}:${this.#options.port}`
          )
        }
        this.#backendStarted = true
        // Skip when in REUSE mode — the rerun child reuses the parent's window.
        if (this.#options.openUi && !this.#isReuse) {
          this.#openUiWindow()
        }
      } catch (err) {
        log.error(`Failed to start backend: ${(err as Error).message}`)
      }
    })()
    return this.#backendStartPromise
  }

  waitForUiReady(): Promise<void> {
    if (this.#uiReadyPromise) {
      return this.#uiReadyPromise
    }
    if (!this.#options.openUi) {
      this.#uiReadyPromise = Promise.resolve()
      return this.#uiReadyPromise
    }

    const UI_READY_TIMEOUT_MS = 12000
    this.#uiReadyPromise = (async () => {
      await this.ensureBackendStarted()
      if (!this.#sessionCapturer) {
        return
      }
      log.info('⏳ Waiting for DevTools UI to connect…')
      const timer = new Promise<void>((resolve) =>
        setTimeout(resolve, UI_READY_TIMEOUT_MS)
      )
      await Promise.race([this.#sessionCapturer.awaitClientConnected(), timer])
      log.info('✓ DevTools UI ready — proceeding with tests')
    })()
    return this.#uiReadyPromise
  }

  configure(
    opts: {
      rerunCommand?: string
      screencast?: ScreencastOptions
      headless?: boolean
      openUi?: boolean
    } = {}
  ) {
    if ('rerunCommand' in opts) {
      this.#rerunManager.configure(opts.rerunCommand)
      this.#options.rerunCommand = opts.rerunCommand
    }
    if (opts.screencast) {
      this.#screencastOptions = {
        ...this.#screencastOptions,
        ...opts.screencast
      }
    }
    if (typeof opts.headless === 'boolean') {
      this.#options.headless = opts.headless
    }
    if (typeof opts.openUi === 'boolean') {
      this.#options.openUi = opts.openUi
    }
  }

  get options() {
    return this.#options
  }

  /** Public API: start a marked test. */
  startTest(
    name: string,
    meta: {
      file?: string
      callSource?: string
      suiteName?: string
      suiteCallSource?: string
    } = {}
  ) {
    if (!this.#testFileDir && meta.file) {
      this.#testFileDir = path.dirname(meta.file)
    }
    const stackInfo = getCallSourceFromStack()
    const file = meta.file || stackInfo.filePath
    const callSource = meta.callSource || stackInfo.callSource
    const resolvedMeta: { file?: string; callSource?: string } = {}
    if (file) {
      resolvedMeta.file = file
    }
    if (callSource && callSource !== 'unknown:0') {
      resolvedMeta.callSource = callSource
    }
    if (!this.#suiteManager || !this.#testReporter) {
      this.#pendingTestActions.push({
        kind: 'start',
        name,
        meta: resolvedMeta,
        suiteName: meta.suiteName,
        suiteCallSource: meta.suiteCallSource
      })
      return
    }

    this.#ensureSuiteAndTestManager(
      meta.suiteName ?? DEFAULTS.SESSION_TITLE,
      meta.suiteCallSource
    )
    if (meta.suiteName || meta.suiteCallSource) {
      this.#suiteManager.setRootSuiteTitle(
        meta.suiteName ?? '',
        meta.suiteCallSource
      )
    }

    this.#testManager!.startMarkedTest(name, resolvedMeta)
    this.#lastCapturedSig = null
    this.#lastCapturedId = null
    if (file) {
      this.#sessionCapturer?.captureSource(file).catch(() => {})
    }
  }

  endTest(state: TestStats['state'] = 'passed') {
    if (!this.#testManager) {
      this.#pendingTestActions.push({ kind: 'end', state })
      return
    }
    this.#testManager.endCurrent(state)
  }

  /** Cucumber scenario boundary — opens a sub-suite under the feature root. */
  startScenario(
    name: string,
    meta: {
      file?: string
      callSource?: string
      featureName?: string
      featureCallSource?: string
    } = {}
  ) {
    if (!this.#suiteManager || !this.#testReporter) {
      this.#pendingScenario = { name, ...meta }
      return
    }
    this.#ensureSuiteAndTestManager(
      meta.featureName ?? DEFAULTS.SESSION_TITLE,
      meta.featureCallSource
    )
    if (meta.featureName || meta.featureCallSource) {
      this.#suiteManager.setRootSuiteTitle(
        meta.featureName ?? '',
        meta.featureCallSource
      )
    }
    // Stamp the .feature path as `featureFile` on the root and the scenario
    // sub-suite. The root suite's `file` stays at process.cwd() (changing it
    // mid-run would shift the stable UID and orphan accumulated state on the
    // dashboard). The dashboard's rerun payload forwards `featureFile` to the
    // backend, which strips `--name` and uses it as a positional arg for
    // feature-level reruns.
    const root = this.#suiteManager.getRootSuite()
    if (root && meta.file && root.featureFile !== meta.file) {
      root.featureFile = meta.file
      this.#testReporter.updateSuites()
    }
    const file = meta.file ?? root?.file ?? process.cwd()
    this.#suiteManager.startScenarioSuite(
      name,
      file,
      meta.callSource,
      meta.file
    )
    this.#lastCapturedSig = null
    this.#lastCapturedId = null
    if (meta.file) {
      this.#sessionCapturer?.captureSource(meta.file).catch(() => {})
    }
  }

  endScenario(state: TestStats['state'] = 'passed') {
    if (!this.#suiteManager) {
      return
    }
    this.#testManager?.endCurrent(state)
    this.#suiteManager.endScenarioSuite(state)
    this.#lastCapturedSig = null
    this.#lastCapturedId = null
  }

  /** Lazy-create rootSuite + testManager so they take the real describe title. */
  #ensureSuiteAndTestManager(title: string, callSource?: string): void {
    if (!this.#suiteManager || !this.#testReporter) {
      return
    }
    let rootSuite = this.#suiteManager.getRootSuite()
    const created = !rootSuite
    if (!rootSuite) {
      const effectiveTitle = this.#pendingScenario?.featureName ?? title
      rootSuite = this.#suiteManager.getOrCreateRootSuite(
        process.cwd(),
        effectiveTitle
      )
      const cs = this.#pendingScenario?.featureCallSource ?? callSource
      if (cs) {
        rootSuite.callSource = cs
      }
    }
    if (!this.#testManager) {
      this.#testManager = new TestManager(
        rootSuite,
        this.#testReporter,
        this.#suiteManager
      )
    }
    if (created && this.#pendingScenario) {
      const p = this.#pendingScenario
      this.#pendingScenario = null
      const file = p.file ?? rootSuite.file
      this.#suiteManager.startScenarioSuite(p.name, file, p.callSource)
      if (p.file) {
        this.#sessionCapturer?.captureSource(p.file).catch(() => {})
      }
    }
  }

  /** Apply any startTest/endTest calls buffered before testManager existed. */
  #flushPendingTestActions() {
    if (this.#pendingTestActions.length === 0) {
      return
    }
    for (const action of this.#pendingTestActions) {
      if (action.kind === 'start') {
        this.#ensureSuiteAndTestManager(
          action.suiteName ?? DEFAULTS.SESSION_TITLE,
          action.suiteCallSource
        )
        if (!this.#testManager) {
          continue
        }
        if (action.suiteName || action.suiteCallSource) {
          this.#suiteManager?.setRootSuiteTitle(
            action.suiteName ?? '',
            action.suiteCallSource
          )
        }
        this.#testManager.startMarkedTest(action.name, action.meta)
        if (action.meta.file) {
          this.#sessionCapturer?.captureSource(action.meta.file).catch(() => {})
        }
      } else {
        this.#testManager?.endCurrent(action.state)
      }
    }
    this.#pendingTestActions = []
  }

  async onDriverCreated(driver: SeleniumDriverLike) {
    const driverReadyTs = Date.now()
    await this.ensureBackendStarted()

    if (this.#driver === driver) {
      return
    }

    // Fresh-driver-per-test: re-target capturer; reuse suite/reporter/testManager.
    if (this.#driver || this.#sessionCapturer) {
      log.info('New driver detected — re-targeting capturer for next test')
      this.#driver = driver
      this.#sessionCapturer?.setDriver(driver)
      await this.#initPerDriverCapture(driver, driverReadyTs)
      return
    }

    this.#driver = driver

    this.#sessionCapturer = new SessionCapturer(
      { hostname: this.#options.hostname, port: this.#options.port },
      driver
    )
    // Dashboard closed AFTER tests finished → wind the runner down so the
    // user doesn't have to Ctrl+C. Ignore during a live run: a momentary
    // reconnect blip during tests must not abort them.
    this.#sessionCapturer.setClientDisconnectedHandler(() => {
      if (this.finalized) {
        void gracefulShutdown(this, 0)
      }
    })
    await this.#sessionCapturer.waitForConnection(TIMING.UI_CONNECTION_WAIT)

    this.#testReporter = new TestReporter((suitesData) => {
      this.#sessionCapturer?.sendUpstream('suites', suitesData)
    })
    this.#suiteManager = new SuiteManager(this.#testReporter)
    this.#flushPendingTestActions()

    await this.#initPerDriverCapture(driver, driverReadyTs)
  }

  async #initPerDriverCapture(
    driver: SeleniumDriverLike,
    driverReadyTs: number
  ) {
    if (!this.#sessionCapturer) {
      return
    }

    const { sessionId, metadata } = await buildDriverMetadata({
      driver,
      driverReadyTs,
      runner: RUNNER,
      rerunCommand: this.#options.rerunCommand,
      rerunTemplate: this.#rerunManager.rerunTemplate,
      launchCommand: this.#rerunManager.launchCommand
    })
    this.#sessionId = sessionId
    if (metadata) {
      this.#sessionCapturer.sendUpstream('metadata', metadata)
    }

    // Parallel — serial attach misses frames on fast tests.
    const screencastPromise = this.#screencastOptions.enabled
      ? (async () => {
          try {
            this.#screencast = new ScreencastRecorder(this.#screencastOptions)
            await this.#screencast.start(driver)
          } catch (err) {
            log.warn(`Screencast start failed: ${(err as Error).message}`)
          }
        })()
      : Promise.resolve()

    const bidiPromise = (async () => {
      try {
        const sinks = buildBidiSinks(this.#sessionCapturer!)
        const ok = await attachBidiHandlers(driver, sinks)
        if (ok) {
          this.#sessionCapturer!.bidiActive = true
          log.info(
            '✓ BiDi data flow active — script-injected console/network suppressed'
          )
        }
      } catch (err) {
        log.warn(`BiDi attach threw: ${(err as Error).message}`)
      }
    })()

    await Promise.all([screencastPromise, bidiPromise])
  }

  async onCommand(cmd: CapturedCommand) {
    const capturer = this.#sessionCapturer
    const testManager = this.#testManager
    if (!capturer || !testManager) {
      return
    }

    const test = testManager.getOrEnsureTest()
    if (!test) {
      return
    }

    const error =
      cmd.error && cmd.error instanceof Error
        ? cmd.error
        : cmd.error
          ? new Error(String(cmd.error))
          : undefined

    const cmdSig = JSON.stringify({
      command: cmd.command,
      args: cmd.args,
      src: cmd.callSource ?? null
    })
    const isRetry =
      this.#lastCapturedSig === cmdSig && this.#lastCapturedId !== null

    let entry: CommandLog & { _id?: number }
    if (isRetry) {
      const replaced = capturer.replaceCommand(
        this.#lastCapturedId!,
        cmd.command,
        cmd.args.map((a: any) => a),
        error ? undefined : cmd.result,
        error,
        test.uid,
        cmd.callSource,
        cmd.timestamp
      )
      entry = replaced.entry as CommandLog & { _id?: number }
      this.#lastCapturedId = entry._id ?? null
      capturer.sendReplaceCommand(replaced.oldTimestamp, entry)
    } else {
      entry = (await capturer.captureCommand(
        cmd.command,
        cmd.args,
        cmd.result,
        error,
        test.uid,
        cmd.callSource,
        cmd.timestamp
      )) as CommandLog & { _id?: number }
      capturer.sendCommand(entry)
      this.#lastCapturedSig = cmdSig
      this.#lastCapturedId = entry._id ?? null
    }

    if (this.#options.captureScreenshots && !error) {
      const ts = entry.timestamp
      capturer
        .takeScreenshot()
        .then((shot) => {
          if (shot) {
            entry.screenshot = shot
            capturer.sendReplaceCommand(ts, entry)
          }
        })
        .catch(() => {})
    }

    // Enrich opaque WebElement results with tag + text preview for the UI.
    if (
      !error &&
      cmd.rawResult &&
      (cmd.command === 'findElement' || cmd.command === 'findElements')
    ) {
      void enrichFindResult(capturer, cmd.rawResult, entry, entry.timestamp)
    }

    if (capturer.isNavigationCommand(cmd.command) && !cmd.fromElement) {
      captureNavigationTrace(
        capturer,
        this.#scriptInjected,
        () => {
          this.#scriptInjected = true
        },
        () => this.#finalized
      )
    }
  }

  #openUiWindow() {
    if (this.#uiUrlOpened) {
      return
    }
    this.#uiUrlOpened = true
    openDashboard(this.#options.hostname, this.#options.port)
  }

  #finalized = false
  get finalized() {
    return this.#finalized
  }

  /** Per-driver cleanup; keeps capturer/suite/testManager/backend alive. */
  async onDriverEnd() {
    if (this.#screencast && this.#sessionId) {
      await finalizeScreencast({
        screencast: this.#screencast,
        sessionId: this.#sessionId,
        testFileDir: this.#testFileDir,
        captureFormat: this.#screencastOptions.captureFormat,
        sendUpstream: (scope, data) =>
          this.#sessionCapturer?.sendUpstream(scope, data)
      })
    }
    this.#driver = undefined
    this.#screencast = undefined
    this.#scriptInjected = false
    this.#sessionId = undefined
    this.#lastCapturedSig = null
    this.#lastCapturedId = null
  }

  /** Final teardown. Idempotent. */
  async onSessionEnd() {
    if (this.#finalized) {
      return
    }
    this.#finalized = true
    const shutdownStart = Date.now()
    try {
      await this.onDriverEnd().catch(() => {})

      // Don't call suiteManager.finalize() here — it sets `root.end`, which
      // signals the dashboard's rerun tracker that the feature has finished
      // and unblocks the new-run reset for the next scenario. onSessionEnd
      // fires on each `driver.quit()` (per cucumber scenario), so finalizing
      // the root here is premature. The true end-of-run finalize happens in
      // finalizeTestRun (cucumber AfterAll). testReporter.updateSuites() is
      // still useful to flush per-scenario state to the dashboard.
      this.#testManager?.finalizeSession()
      this.#testReporter?.updateSuites()

      const cmdCount = this.#sessionCapturer?.commandsLog.length ?? 0
      const consoleCount = this.#sessionCapturer?.consoleLogs.length ?? 0
      const networkCount = this.#sessionCapturer?.networkRequests.length ?? 0
      log.info(
        `📊 Session summary — ${cmdCount} command(s), ${networkCount} network request(s), ${consoleCount} console log(s)`
      )
      this.#sessionCapturer?.cleanup()

      // Interactive path: dashboard is up — wait for the user to close it,
      // then finish teardown. Matches wdio's "Please close the browser
      // window to finish..." UX. The worker WS stays open as the channel
      // the backend uses to signal `clientDisconnected`.
      if (this.#options.openUi && !this.#isReuse) {
        log.info(
          `💡 Tests complete — DevTools UI: http://${this.#options.hostname}:${this.#options.port}`
        )
        log.info(
          '🔵 Close the DevTools browser window (or press Ctrl+C) to finish'
        )
        this.#keepAliveTimer = setInterval(() => {}, 60 * 60 * 1000)
        this.#sessionCapturer?.setClientDisconnectedHandler(() => {
          log.info('Dashboard closed — shutting down')
          this.clearKeepAlive()
          void this.#completeShutdown(shutdownStart)
        })
        return
      }

      // Non-interactive path (no dashboard or rerun child). Don't close the
      // WS yet: this `onSessionEnd` is reached via the patched `driver.quit()`
      // (cucumber's per-scenario `After` hook), but the runner's
      // `onScenarioEnd` hook fires AFTER `After`. Closing the WS here would
      // drop the final state update. Defer the close to `beforeExit`/`exit`,
      // by which time every post-quit runner hook has flushed.
      log.info(`🛑 Session ended (${Date.now() - shutdownStart}ms)`)
    } catch (err) {
      log.warn(`Cleanup error: ${(err as Error).message}`)
    }
  }

  /**
   * Final cleanup once the user has closed the dashboard browser. Drives the
   * remaining teardown explicitly and `exit(0)`s — the natural event-loop
   * drain doesn't fire reliably because the detached backend's own close
   * races with the worker WS close.
   */
  async #completeShutdown(shutdownStart: number) {
    try {
      await this.#sessionCapturer?.closeWebSocket()
    } catch {
      /* best-effort */
    }
    log.info(`🛑 Shutdown complete (${Date.now() - shutdownStart}ms)`)
    process.exit(0)
  }

  async onProcessExit() {
    return this.onSessionEnd()
  }

  /** Mark suite finished on after-all so the dashboard updates pre-exit. */
  finalizeTestRun() {
    this.#testManager?.finalizeSession()
    this.#suiteManager?.finalize()
    this.#testReporter?.updateSuites()
    // Reuse mode (rerun child): close the WS now so the child's event loop
    // can drain and the process exits on its own. Outside reuse, the parent
    // owns the WS lifecycle via the keep-alive + clientDisconnected handler.
    // onTestRunComplete fires AFTER per-scenario `After` hooks, so any state
    // updates queued in the cucumber lifecycle have already flushed.
    if (this.#isReuse) {
      void this.#sessionCapturer?.closeWebSocket()
    }
  }

  get sessionCapturer() {
    return this.#sessionCapturer
  }
  get isReuse() {
    return this.#isReuse
  }
  get rerunManager() {
    return this.#rerunManager
  }

  clearKeepAlive() {
    if (this.#keepAliveTimer) {
      clearInterval(this.#keepAliveTimer)
      this.#keepAliveTimer = undefined
    }
  }
}

const plugin = new SeleniumDevToolsPlugin()

const patched = patchSelenium({
  onBeforeBuild: (builder) => {
    ensureBidiCapability(builder)
    if (plugin.options.headless) {
      ensureHeadlessChrome(builder)
    }
  },
  onDriverCreated: (driver) => plugin.onDriverCreated(driver),
  onCommand: (cmd) => plugin.onCommand(cmd),
  onBeforeQuit: () => plugin.onSessionEnd(),
  // Block `await Builder.build()` until the dashboard is connected.
  waitForReady: () => plugin.waitForUiReady()
})

if (patched) {
  log.info('✓ selenium-devtools attached — waiting for driver creation')
}

// node:assert wrappers silently invert match/doesNotMatch — kept disabled.
void patchNodeAssert

// Runner globals are published after `--require`, so retry briefly.
function registerHooks() {
  return tryRegisterRunnerHooks({
    onTestStart: (name, file, callSource, suiteName, suiteCallSource) => {
      const meta: {
        file?: string
        callSource?: string
        suiteName?: string
        suiteCallSource?: string
      } = {}
      if (file) {
        meta.file = file
      }
      if (callSource) {
        meta.callSource = callSource
      }
      if (suiteName) {
        meta.suiteName = suiteName
      }
      if (suiteCallSource) {
        meta.suiteCallSource = suiteCallSource
      }
      plugin.startTest(name, meta)
    },
    onTestEnd: (state) => {
      plugin.endTest(state === 'pending' ? 'skipped' : state)
    },
    onScenarioStart: (
      name,
      file,
      callSource,
      featureName,
      featureCallSource
    ) => {
      plugin.startScenario(name, {
        file,
        callSource,
        featureName,
        featureCallSource
      })
    },
    onScenarioEnd: (state) => {
      plugin.endScenario(state === 'pending' ? 'skipped' : state)
    },
    onTestRunComplete: () => {
      plugin.finalizeTestRun()
    }
  })
}
if (!registerHooks()) {
  let attempts = 0
  const interval = setInterval(() => {
    attempts++
    if (registerHooks() || attempts >= 20) {
      clearInterval(interval)
    }
  }, 100)
}

registerProcessHooks(plugin)

export const DevTools = {
  configure: (opts: { rerunCommand?: string }) => plugin.configure(opts),
  startTest: (name: string, meta?: { file?: string }) =>
    plugin.startTest(name, meta),
  endTest: (state: TestStats['state'] = 'passed') => plugin.endTest(state)
}

export default DevTools
export { TEST_STATE, NAVIGATION_COMMANDS }
export type { DevToolsOptions, TestStats }
