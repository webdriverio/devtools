// @wdio/selenium-devtools — runner-agnostic Selenium WebDriver adapter.
// Side-effect import that patches selenium-webdriver and starts the backend.

import './setupConsole.js'
import logger from '@wdio/logger'
import { startDetachedBackend } from './helpers/detachedBackend.js'
import { openDashboard } from './helpers/dashboardLauncher.js'
import { handleOnCommand } from './helpers/commandPostActions.js'
import { logConfigSummary } from './helpers/configSummary.js'
import { registerProcessHooks } from './helpers/processHooks.js'
import { patchSelenium } from './driverPatcher.js'
import { ensureBidiCapability, ensureHeadlessChrome } from './bidi.js'
import type { SessionCapturer } from './session.js'
import type { TestReporter } from './reporter.js'
import type { SuiteManager } from './helpers/suiteManager.js'
import type { TestManager } from './helpers/testManager.js'
import { RerunManager } from './rerunManager.js'
import type { ScreencastRecorder } from './screencast.js'
import {
  onDriverCreated as sessionOnDriverCreated,
  onDriverEnd as sessionOnDriverEnd,
  onSessionEnd as sessionOnSessionEnd,
  setPluginRef,
  recordSpecBoundary
} from './session-lifecycle.js'
import type { SpecRange } from '@wdio/devtools-core'
import {
  startTest as tmStartTest,
  endTest as tmEndTest,
  startScenario as tmStartScenario,
  endScenario as tmEndScenario,
  flushPendingTestActions as tmFlushPendingTestActions,
  type StartTestMeta,
  type StartScenarioMeta
} from './test-management.js'
import type { PluginInternals } from './plugin-internals.js'
import {
  detectOwnVersion,
  detectRunner,
  detectSeleniumVersion
} from './helpers/runtime.js'
import { findFreePort } from './helpers/utils.js'
import { RetryTracker, errorMessage } from '@wdio/devtools-core'
import { tryRegisterRunnerHooks } from './runnerHooks.js'
import { patchNodeAssert } from './assertPatcher.js'
import {
  REUSE_ENV,
  SCREENCAST_DEFAULTS,
  TEST_STATE,
  NAVIGATION_COMMANDS
} from './constants.js'
import {
  type ActionSnapshot,
  type CapturedCommand,
  type DevToolsMode,
  type DevToolsOptions,
  type ScreencastOptions,
  type TraceFormat,
  type TraceGranularity,
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
  #retryTracker = new RetryTracker()
  #screencast?: ScreencastRecorder
  #screencastOptions: ScreencastOptions
  #actionSnapshots: ActionSnapshot[] = []
  #snapshotCaptures: Promise<void>[] = []
  #sessionId?: string
  #uiUrlOpened = false
  #testFilePath?: string
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

  /** Index ranges into the session capturer's flat arrays, one per spec file. */
  #specRanges: SpecRange[] = []

  /** Set of spec files already flushed to disk. */
  #flushedSpecs = new Set<string>()

  constructor(options: DevToolsOptions = {}) {
    this.#options = {
      port: options.port ?? 3000,
      hostname: options.hostname ?? 'localhost',
      openUi: options.openUi ?? true,
      captureScreenshots: options.captureScreenshots ?? true,
      captureAssertions: options.captureAssertions ?? true,
      rerunCommand: options.rerunCommand,
      headless: options.headless ?? false,
      mode: options.mode ?? 'live',
      traceFormat: options.traceFormat ?? 'zip',
      traceGranularity: options.traceGranularity ?? 'session'
    }
    this.#rerunManager = new RerunManager(RUNNER)
    if (options.rerunCommand) {
      this.#rerunManager.configure(options.rerunCommand)
    }
    // Same gate as DevTools.configure() — direct construction with
    // `{ mode: 'trace', screencast: { enabled: true } }` would otherwise
    // bypass the runtime check.
    if (
      this.#options.mode === 'trace' &&
      options.screencast?.enabled === true
    ) {
      log.warn('trace mode: ignoring screencast option (live-mode feature)')
      this.#screencastOptions = { ...SCREENCAST_DEFAULTS }
    } else {
      this.#screencastOptions = {
        ...SCREENCAST_DEFAULTS,
        ...(options.screencast ?? {})
      }
    }
    // Reuse mode: rerun child inherits the parent's backend host/port.
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

  #configSummaryLogged = false
  #logConfigSummary() {
    if (this.#configSummaryLogged) {
      return
    }
    this.#configSummaryLogged = true
    logConfigSummary({
      openUi: this.#options.openUi,
      headless: this.#options.headless,
      captureScreenshots: this.#options.captureScreenshots,
      rerunCommand: this.#options.rerunCommand,
      screencast: this.#screencastOptions,
      rerunManager: this.#rerunManager
    })
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
        // Trace mode parity with WDIO launcher gate: skip backend port-bind
        // entirely — no UI to serve, SessionCapturer WS init is also gated
        // off in session-lifecycle.ts.
        if (this.#options.mode === 'trace') {
          log.info('Trace mode — skipping backend port-bind and UI window')
          this.#backendStarted = true
          return
        }
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
        // mode==='trace' returned early above; only live mode reaches here.
        if (this.#options.openUi && !this.#isReuse) {
          this.#openUiWindow()
        }
      } catch (err) {
        log.error(`Failed to start backend: ${errorMessage(err)}`)
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
      captureAssertions?: boolean
      mode?: DevToolsMode
      traceFormat?: TraceFormat
      traceGranularity?: TraceGranularity
    } = {}
  ) {
    if ('rerunCommand' in opts) {
      this.#rerunManager.configure(opts.rerunCommand)
      this.#options.rerunCommand = opts.rerunCommand
    }
    if (typeof opts.headless === 'boolean') {
      this.#options.headless = opts.headless
    }
    if (typeof opts.captureAssertions === 'boolean') {
      this.#options.captureAssertions = opts.captureAssertions
    }
    if (typeof opts.openUi === 'boolean') {
      this.#options.openUi = opts.openUi
    }
    if (opts.mode) {
      this.#options.mode = opts.mode
    }
    if (opts.traceFormat) {
      this.#options.traceFormat = opts.traceFormat
    }
    if (opts.traceGranularity) {
      this.#options.traceGranularity = opts.traceGranularity
    }
    if (opts.screencast) {
      if (this.#options.mode === 'trace' && opts.screencast.enabled) {
        log.warn('trace mode: ignoring screencast option (live-mode feature)')
      } else {
        this.#screencastOptions = {
          ...this.#screencastOptions,
          ...opts.screencast
        }
      }
    }
  }

  get options() {
    return this.#options
  }

  // Single internals "bag" — structurally satisfies both lifecycle ctx
  // interfaces. Lifecycle modules cast it to their narrow type at call time.
  #internals: PluginInternals | undefined
  // Declarative accessor map — splitting this purely to satisfy the
  // line-count rule hurts readability; the body is mechanical wiring.
  // eslint-disable-next-line max-lines-per-function
  #getInternals(): PluginInternals {
    if (this.#internals) {
      return this.#internals
    }
    const self = this
    this.#internals = {
      get options() {
        return self.#options
      },
      get screencastOptions() {
        return self.#screencastOptions
      },
      get runner() {
        return RUNNER
      },
      get rerunTemplate() {
        return self.#rerunManager.rerunTemplate
      },
      get launchCommand() {
        return self.#rerunManager.launchCommand
      },
      get isReuse() {
        return self.#isReuse
      },
      get finalized() {
        return self.#finalized
      },
      get retryTracker() {
        return self.#retryTracker
      },
      get driver() {
        return self.#driver
      },
      set driver(v) {
        self.#driver = v
      },
      get sessionCapturer() {
        return self.#sessionCapturer
      },
      set sessionCapturer(v) {
        self.#sessionCapturer = v
      },
      get testReporter() {
        return self.#testReporter
      },
      set testReporter(v) {
        self.#testReporter = v
      },
      get suiteManager() {
        return self.#suiteManager
      },
      set suiteManager(v) {
        self.#suiteManager = v
      },
      get testManager() {
        return self.#testManager
      },
      set testManager(v) {
        self.#testManager = v
      },
      get screencast() {
        return self.#screencast
      },
      set screencast(v) {
        self.#screencast = v
      },
      get sessionId() {
        return self.#sessionId
      },
      set sessionId(v) {
        self.#sessionId = v
      },
      get scriptInjected() {
        return self.#scriptInjected
      },
      set scriptInjected(v) {
        self.#scriptInjected = v
      },
      get testFilePath() {
        return self.#testFilePath
      },
      set testFilePath(v) {
        self.#testFilePath = v
      },
      get keepAliveTimer() {
        return self.#keepAliveTimer
      },
      set keepAliveTimer(v) {
        self.#keepAliveTimer = v
      },
      get pendingTestActions() {
        return self.#pendingTestActions
      },
      set pendingTestActions(v) {
        self.#pendingTestActions = v
      },
      get pendingScenario() {
        return self.#pendingScenario
      },
      set pendingScenario(v) {
        self.#pendingScenario = v
      },
      get specRanges() {
        return self.#specRanges
      },
      get flushedSpecs() {
        return self.#flushedSpecs
      },
      setFinalized: (v) => {
        self.#finalized = v
      },
      setScriptInjected: (v) => {
        self.#scriptInjected = v
      },
      get actionSnapshots() {
        return self.#actionSnapshots
      },
      get snapshotCaptures() {
        return self.#snapshotCaptures
      },
      ensureBackendStarted: () => self.ensureBackendStarted(),
      flushPendingTestActions: () => self.#flushPendingTestActions(),
      resetRetryTracker: () => self.#retryTracker.reset(),
      clearKeepAlive: () => self.clearKeepAlive()
    }
    setPluginRef(this.#internals, this)
    return this.#internals
  }

  /** Public API: start a marked test. */
  startTest(name: string, meta: StartTestMeta = {}) {
    tmStartTest(this.#getInternals(), name, meta)
    if (meta.file) {
      recordSpecBoundary(this.#getInternals(), meta.file)
    }
  }

  endTest(state: TestStats['state'] = 'passed') {
    tmEndTest(this.#getInternals(), state)
  }

  startScenario(name: string, meta: StartScenarioMeta = {}) {
    tmStartScenario(this.#getInternals(), name, meta)
    if (meta.file) {
      recordSpecBoundary(this.#getInternals(), meta.file)
    }
  }

  endScenario(state: TestStats['state'] = 'passed') {
    tmEndScenario(this.#getInternals(), state)
  }

  #flushPendingTestActions() {
    tmFlushPendingTestActions(this.#getInternals())
  }

  async onDriverCreated(driver: SeleniumDriverLike) {
    await sessionOnDriverCreated(this.#getInternals(), driver)
  }

  async onCommand(cmd: CapturedCommand) {
    await handleOnCommand(this.#getInternals(), cmd)
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
    await sessionOnDriverEnd(this.#getInternals())
  }

  async onSessionEnd() {
    await sessionOnSessionEnd(this.#getInternals())
  }

  async onProcessExit() {
    return this.onSessionEnd()
  }

  /**
   * Cucumber / mocha / jest after-all hook. Mark the suite finished so the
   * dashboard updates pre-exit, then run the session-wide teardown
   * (`onSessionEnd`) — capturer cleanup, summary log, interactive shutdown
   * path. `onBeforeQuit` already handled the PER-driver finalize for each
   * scenario; this is the one-time finish.
   *
   * onTestRunComplete fires AFTER per-scenario `After` hooks, so any state
   * updates queued in the cucumber lifecycle have already flushed by here.
   */
  async finalizeTestRun() {
    this.#testManager?.finalizeSession()
    this.#suiteManager?.finalize()
    this.#testReporter?.updateSuites()
    if (this.#isReuse) {
      // Reuse mode (rerun child): close the WS now so the child's event
      // loop can drain and the process exits on its own. Skip
      // onSessionEnd's interactive shutdown branch.
      void this.#sessionCapturer?.closeWebSocket()
      return
    }
    await this.onSessionEnd()
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
  // Per-scenario cleanup ONLY here (finalizes that driver's screencast,
  // clears per-driver state). The session-wide teardown — set-finalized,
  // session summary, capturer cleanup, interactive shutdown — lives in
  // `finalizeTestRun` (cucumber/mocha/jest `onTestRunComplete`) and the
  // beforeExit/exit handlers in processHooks. Wiring `onSessionEnd` here
  // broke multi-scenario runs: its `if (finalized) return` guard meant
  // scenario 2+ never got their per-driver finalize → missing screencast.
  onBeforeQuit: () => plugin.onDriverEnd(),
  // Block `await Builder.build()` until the dashboard is connected.
  waitForReady: () => plugin.waitForUiReady()
})

if (patched) {
  log.info('✓ selenium-devtools attached — waiting for driver creation')
}

// Patch eagerly (user specs must see the wrappers before they import assert);
// the gate runs at capture time because DevTools.configure() may arrive later.
patchNodeAssert((cmd) => {
  if (plugin.options.captureAssertions) {
    void plugin.onCommand(cmd)
  }
})

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
      void plugin.finalizeTestRun()
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
  configure: (opts: {
    rerunCommand?: string
    screencast?: ScreencastOptions
    headless?: boolean
    openUi?: boolean
    captureAssertions?: boolean
    mode?: DevToolsMode
    traceFormat?: TraceFormat
    traceGranularity?: TraceGranularity
  }) => plugin.configure(opts),
  startTest: (name: string, meta?: { file?: string }) =>
    plugin.startTest(name, meta),
  endTest: (state: TestStats['state'] = 'passed') => plugin.endTest(state)
}

export default DevTools
export { TEST_STATE, NAVIGATION_COMMANDS }
export type { DevToolsOptions, TestStats }
