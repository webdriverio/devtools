// @wdio/selenium-devtools — runner-agnostic Selenium WebDriver adapter.
// Side-effect import that patches selenium-webdriver and starts the backend.

// MUST be the first import — see setupConsole.ts.
import './setupConsole.js'
import logger from '@wdio/logger'
import { startDetachedBackend } from './helpers/detachedBackend.js'
import { openDashboard } from './helpers/dashboardLauncher.js'
import { captureOrReplaceCommand } from './helpers/captureOrReplaceCommand.js'
import {
  enrichFindResult,
  captureNavigationTrace
} from './helpers/commandPostActions.js'
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
  setPluginRef
} from './session-lifecycle.js'
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
import { findFreePort, getCallSourceFromStack } from './helpers/utils.js'
import { RetryTracker, errorMessage, toError } from '@wdio/devtools-core'
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
  #retryTracker = new RetryTracker()
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

  // Single internals "bag" — structurally satisfies both lifecycle ctx
  // interfaces. Lifecycle modules cast it to their narrow type at call time.
  #internals: PluginInternals | undefined
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
      get testFileDir() {
        return self.#testFileDir
      },
      set testFileDir(v) {
        self.#testFileDir = v
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
      setFinalized: (v) => {
        self.#finalized = v
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
  }

  endTest(state: TestStats['state'] = 'passed') {
    tmEndTest(this.#getInternals(), state)
  }

  startScenario(name: string, meta: StartScenarioMeta = {}) {
    tmStartScenario(this.#getInternals(), name, meta)
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
    const capturer = this.#sessionCapturer
    const testManager = this.#testManager
    if (!capturer || !testManager) {
      return
    }
    const test = testManager.getOrEnsureTest()
    if (!test) {
      return
    }

    const entry = await captureOrReplaceCommand({
      capturer,
      retryTracker: this.#retryTracker,
      test,
      cmd
    })
    const error = cmd.error ? toError(cmd.error) : undefined

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
        () => this.#finalized,
        entry,
        cmd.args,
        this.#driver
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
    await sessionOnDriverEnd(this.#getInternals())
  }

  async onSessionEnd() {
    await sessionOnSessionEnd(this.#getInternals())
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
