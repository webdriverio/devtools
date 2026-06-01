// @wdio/selenium-devtools — runner-agnostic Selenium WebDriver adapter.
// Side-effect import that patches selenium-webdriver and starts the backend.

// MUST be the first import — see setupConsole.ts.
import './setupConsole.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { spawn } from 'node:child_process'
import logger from '@wdio/logger'
import { startDetachedBackend } from './helpers/detachedBackend.js'
import { patchSelenium, getElementOriginals } from './driverPatcher.js'
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
import { encodeToVideo } from './helpers/videoEncoder.js'
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
  TraceType,
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
    const file =
      meta.file ?? this.#suiteManager.getRootSuite()?.file ?? process.cwd()
    this.#suiteManager.startScenarioSuite(name, file, meta.callSource)
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
        void gracefulShutdown(0)
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

    try {
      const session = driver.getSession ? await driver.getSession() : undefined
      const capabilities = driver.getCapabilities
        ? await driver.getCapabilities()
        : undefined
      this.#sessionId = session?.getId?.() ?? undefined
      const capGet = (k: string): any => {
        if (capabilities?.get && typeof capabilities.get === 'function') {
          return capabilities.get(k)
        }
        const serialized = capabilities?.serialize?.() ?? capabilities ?? {}
        return serialized[k]
      }
      const browserName = capGet('browserName') ?? 'unknown'
      const browserVersion = capGet('browserVersion') ?? capGet('version') ?? ''
      const platform = capGet('platformName') ?? capGet('platform') ?? ''
      log.info(
        `🌐 Browser: ${browserName}${browserVersion ? ' ' + browserVersion : ''}${platform ? ' on ' + platform : ''} (sessionId: ${this.#sessionId ?? 'unknown'})`
      )
      const webSocketUrl = capGet('webSocketUrl')
      const chromeOpts = capGet('goog:chromeOptions') ?? {}
      const chromeArgs: string[] = Array.isArray(chromeOpts?.args)
        ? chromeOpts.args
        : []
      const headlessArg = chromeArgs.find((a) => a.startsWith('--headless'))
      log.info(
        `📋 Capabilities sent: browserName=${browserName}, webSocketUrl=${webSocketUrl ? 'on' : 'off'}` +
          (headlessArg ? `, ${headlessArg}` : '') +
          (chromeArgs.length ? `, chromeArgs=${chromeArgs.length}` : '')
      )
      log.info(`Driver session created in ${Date.now() - driverReadyTs}ms`)
      this.#sessionCapturer.sendUpstream('metadata', {
        type: TraceType.Testrunner,
        capabilities: capabilities?.serialize?.() ?? capabilities ?? {},
        sessionId: this.#sessionId,
        options: {
          framework: 'selenium-webdriver',
          baseDir: process.cwd(),
          rerunCommand:
            this.#options.rerunCommand ?? this.#rerunManager.rerunTemplate,
          launchCommand: this.#rerunManager.launchCommand,
          // Cucumber `--name` filters scenarios but not Gherkin steps, so
          // leaf-step rerun stays disabled there.
          runCapabilities: {
            canRunSuites: true,
            canRunTests: RUNNER !== 'cucumber',
            canRunAll: true
          }
        }
      })
    } catch (err) {
      log.warn(`Failed to send metadata: ${(err as Error).message}`)
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
      const ts = entry.timestamp
      void this.#enrichFindResult(cmd.rawResult, entry, ts)
    }

    if (capturer.isNavigationCommand(cmd.command) && !cmd.fromElement) {
      void (async () => {
        try {
          if (!this.#scriptInjected) {
            this.#scriptInjected = true
            await capturer.injectScript()
          }
          await capturer.captureTrace()
          if (!capturer.bidiActive) {
            await capturer.captureBrowserLogs()
          }
        } catch (err) {
          if (!this.#finalized) {
            log.warn(`Trace capture failed: ${(err as Error).message}`)
          }
        }
      })()
    }
  }

  async #enrichFindResult(rawResult: any, entry: any, ts: number) {
    const capturer = this.#sessionCapturer
    if (!capturer) {
      return
    }
    // Unwrapped methods so these probes don't appear as phantom commands.
    const els = getElementOriginals()
    const getTagName = els.getTagName
    const getText = els.getText
    if (!getTagName || !getText) {
      return
    }
    try {
      const elements = Array.isArray(rawResult) ? rawResult : [rawResult]
      const previews = await Promise.all(
        elements.slice(0, 5).map(async (el: any) => {
          const tag = await getTagName(el).catch(() => 'element')
          const text = await getText(el).catch(() => '')
          const trimmed = text.length > 60 ? text.slice(0, 60) + '…' : text
          return trimmed ? `<${tag}>"${trimmed}"` : `<${tag}>`
        })
      )
      const more = elements.length > 5 ? `, +${elements.length - 5} more` : ''
      const enriched = Array.isArray(rawResult)
        ? `[${previews.join(', ')}${more}]`
        : previews[0]
      entry.result = enriched
      capturer.sendReplaceCommand(ts, entry)
    } catch {
      // Element detached / stale — leave the original `<WebElement>` text.
    }
  }

  // `open` merges windows into an existing Chrome process and loses
  // `--user-data-dir` isolation, so we spawn the binary directly.
  #findChromeBinary(): string | null {
    const candidates =
      process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            `${os.homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
          ]
        : process.platform === 'win32'
          ? [
              'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
              'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
              `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
            ]
          : [
              '/usr/bin/google-chrome',
              '/usr/bin/google-chrome-stable',
              '/usr/bin/chromium-browser',
              '/usr/bin/chromium'
            ]
    for (const c of candidates) {
      if (c && fs.existsSync(c)) {
        return c
      }
    }
    return null
  }

  #openUiWindow() {
    if (this.#uiUrlOpened) {
      return
    }
    this.#uiUrlOpened = true
    const url = `http://${this.#options.hostname}:${this.#options.port}`

    const chromeBin = this.#findChromeBinary()
    if (!chromeBin) {
      log.warn(`Chrome binary not found. Open manually: ${url}`)
      return
    }

    const userDataDir = path.join(
      os.tmpdir(),
      `selenium-devtools-ui-${this.#options.port}-${Date.now()}`
    )

    log.info(`Chrome binary: ${chromeBin}`)
    log.info(`💡 Opening DevTools UI: ${url}`)
    const chromeArgs = [
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1600,1200',
      '--new-window',
      url
    ]
    try {
      // Double-fork: a short-lived Node intermediate spawns Chrome detached
      // and exits, so Chrome is reparented to launchd/init and survives any
      // tree-kill the test runner does on its descendants (vitest's pool,
      // jest --forceExit, mocha SIGINT). Same path for every runner.
      const code =
        'require("child_process")' +
        `.spawn(${JSON.stringify(chromeBin)}, ${JSON.stringify(chromeArgs)}, { detached: true, stdio: "ignore" }).unref()`
      const intermediate = spawn(process.execPath, ['-e', code], {
        detached: true,
        stdio: 'ignore'
      })
      intermediate.unref()
      intermediate.on('error', (err) => {
        log.warn(
          `Could not auto-open DevTools UI (${err.message}). Open manually: ${url}`
        )
      })
    } catch (err) {
      log.warn(
        `Could not auto-open DevTools UI (${(err as Error).message}). Open manually: ${url}`
      )
    }
  }

  #finalized = false
  get finalized() {
    return this.#finalized
  }

  /** Per-driver cleanup; keeps capturer/suite/testManager/backend alive. */
  async onDriverEnd() {
    if (this.#screencast) {
      try {
        await this.#screencast.stop()
        const frames = this.#screencast.frames
        if (frames.length > 0 && this.#sessionId) {
          const fileName = `selenium-video-${this.#sessionId}.webm`
          // Output dir priority: test-file dir → cwd → os.tmpdir().
          const candidate = this.#testFileDir || process.cwd()
          let videoPath = path.join(candidate, fileName)
          try {
            fs.accessSync(candidate, fs.constants.W_OK)
          } catch {
            videoPath = path.join(os.tmpdir(), fileName)
          }
          try {
            await encodeToVideo(frames, videoPath, {
              captureFormat: this.#screencastOptions.captureFormat
            })
            log.info(`📹 Screencast video: ${videoPath}`)
            this.#sessionCapturer?.sendUpstream('screencast', {
              sessionId: this.#sessionId,
              videoPath,
              videoFile: fileName,
              frameCount: frames.length
            })
          } catch (err) {
            log.warn(`Screencast encode failed: ${(err as Error).message}`)
          }
        }
      } catch (err) {
        log.warn(`Screencast stop failed: ${(err as Error).message}`)
      }
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

      this.#testManager?.finalizeSession()
      this.#suiteManager?.finalize()
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

      // Non-interactive path (no dashboard or rerun child): close the WS now
      // and log the final shutdown.
      await this.#sessionCapturer?.closeWebSocket()
      log.info(`🛑 Shutdown complete (${Date.now() - shutdownStart}ms)`)
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
  }

  get sessionCapturer() {
    return this.#sessionCapturer
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

process.on('exit', () => {
  void plugin.onSessionEnd()
})
process.on('beforeExit', () => {
  void plugin.onSessionEnd()
})

async function gracefulShutdown(code: number) {
  try {
    plugin.clearKeepAlive()
    await plugin.sessionCapturer?.closeWebSocket()
    plugin.sessionCapturer?.cleanup()
    // Best-effort: kill the detached Chrome dashboard. Each session's
    // --user-data-dir contains the unique `selenium-devtools-ui-${port}`
    // marker, so a pattern match lands on this run's window only.
    try {
      spawn(
        '/usr/bin/pkill',
        ['-f', `selenium-devtools-ui-${plugin.options.port}-`],
        { stdio: 'ignore' }
      )
    } catch {
      /* pkill missing — accept stale Chrome */
    }
  } catch {
    /* best-effort */
  }
  process.exit(code)
}

process.on('SIGINT', () => {
  void gracefulShutdown(130)
})
process.on('SIGTERM', () => {
  void gracefulShutdown(143)
})

export const DevTools = {
  configure: (opts: { rerunCommand?: string }) => plugin.configure(opts),
  startTest: (name: string, meta?: { file?: string }) =>
    plugin.startTest(name, meta),
  endTest: (state: TestStats['state'] = 'passed') => plugin.endTest(state)
}

export default DevTools
export { TEST_STATE, NAVIGATION_COMMANDS }
export type { DevToolsOptions, TestStats }
