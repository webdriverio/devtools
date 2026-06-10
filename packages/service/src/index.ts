/// <reference types="../../script/types.d.ts" />
import fs from 'node:fs/promises'
import path from 'node:path'

import logger from '@wdio/logger'
import {
  errorMessage,
  mapCommandToAction,
  writeTraceZip
} from '@wdio/devtools-core'
import { captureActionSnapshot } from './action-snapshot.js'
import type { ActionSnapshot } from '@wdio/devtools-shared'
import { SevereServiceError } from 'webdriverio'
import type { Services, Reporters, Capabilities, Options } from '@wdio/types'
import type { WebDriverCommands } from '@wdio/protocols'

import { SessionCapturer } from './session.js'
import { TestReporter } from './reporter.js'
import { DevToolsAppLauncher } from './launcher.js'
import { getBrowserObject, isUserSpecFile } from './utils.js'
import { ScreencastRecorder } from './screencast.js'
import { attachBidiListeners } from './bidi-listeners.js'
import {
  finalizeScreencast,
  resolveAdapterOutputDir
} from '@wdio/devtools-core'
import { parse } from 'stack-trace'
import {
  type TraceLog,
  TraceType,
  type ServiceOptions,
  type ScreencastOptions
} from './types.js'
import { INTERNAL_COMMANDS, CONTEXT_CHANGE_COMMANDS } from './constants.js'

export * from './types.js'
export const launcher = DevToolsAppLauncher

const log = logger('@wdio/devtools-service')

type CommandFrame = {
  command: string
  callSource?: string
}

export { setupForDevtools } from './standalone.js'
import { detectInvocationConfigPath } from './standalone.js'

export default class DevToolsHookService implements Services.ServiceInstance {
  #testReporters: TestReporter[] = []
  #sessionCapturer = new SessionCapturer()
  #browser?: WebdriverIO.Browser
  #bidiListenersSetup = false
  #screencastRecorder?: ScreencastRecorder
  #screencastOptions?: ScreencastOptions
  #options: ServiceOptions
  #actionSnapshots: ActionSnapshot[] = []
  #snapshotCaptures: Promise<void>[] = []

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

  // This is used to capture the last command signature to avoid duplicate captures
  #lastCommandSig: string | null = null

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
     * Block until injection completes BEFORE any test commands
     */
    try {
      await this.#injectScriptSync(browser)
    } catch (err) {
      log.error(
        `Failed to inject script at session start: ${errorMessage(err)}`
      )
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
     * propagate session metadata at the beginning of the session
     */
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
   * beforeScenario is triggered at the beginning of every worker session, therefore
   * we can use it to reset the command stack and last command signature
   */
  beforeScenario() {
    this.resetStack()
  }

  /**
   * Hook for Mocha/Jasmine frameworks.
   * It does the exact same thing as beforeScenario.
   */
  beforeTest() {
    this.resetStack()
  }

  private resetStack() {
    this.#lastCommandSig = null
    this.#commandStack = []
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
    args: string[],
    callSource: string | undefined
  ): void {
    if (INTERNAL_COMMANDS.includes(command)) {
      return
    }
    const cmdSig = JSON.stringify({ command, args, src: callSource })
    if (this.#lastCommandSig !== cmdSig) {
      this.#commandStack.push({ command, callSource })
      this.#lastCommandSig = cmdSig
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
        args,
        this.#resolveCallSourceFromFrame(source)
      )
    }
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
        const captured = this.#sessionCapturer.afterCommand(
          this.#browser,
          command,
          args,
          result,
          error,
          frame.callSource
        )
        if (
          this.#options.mode === 'trace' &&
          !error &&
          mapCommandToAction(command)
        ) {
          // Drain the previous capture before starting the next so the
          // screenshot for command N represents the post-N, pre-N+1 boundary.
          if (this.#snapshotCaptures.length) {
            await Promise.allSettled(this.#snapshotCaptures)
            this.#snapshotCaptures = []
          }
          const browser = this.#browser
          this.#snapshotCaptures.push(
            captureActionSnapshot(browser, command).then((snap) => {
              if (snap) {
                this.#actionSnapshots.push(snap)
              }
            })
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
   * we can use it to write all trace information to a file
   */
  async after() {
    if (!this.#browser) {
      return
    }

    // Stop and encode the screencast for the current session.
    await this.#finalizeScreencast(this.#browser.sessionId)

    // Drain in-flight per-action snapshots before writing the trace.
    if (this.#snapshotCaptures.length) {
      await Promise.allSettled(this.#snapshotCaptures)
    }

    const outputDir = this.#outputDir
    const { ...options } = this.#browser.options
    const traceLog: TraceLog = {
      mutations: this.#sessionCapturer.mutations,
      logs: this.#sessionCapturer.traceLogs,
      consoleLogs: this.#sessionCapturer.consoleLogs,
      networkRequests: this.#sessionCapturer.networkRequests,
      metadata: {
        ...this.#sessionCapturer.metadata!,
        type: this.captureType,
        options,
        capabilities: this.#browser.capabilities as Capabilities.W3CCapabilities
      },
      commands: this.#sessionCapturer.commandsLog,
      sources: Object.fromEntries(this.#sessionCapturer.sources),
      suites: this.#testReporters.map((reporter) => reporter.report),
      ...(this.#actionSnapshots.length
        ? { actionSnapshots: this.#actionSnapshots }
        : {})
    }

    if (this.#options.mode === 'trace') {
      const tracePath = await writeTraceZip(this.#sessionCapturer, {
        outputDir,
        sessionId: this.#browser.sessionId,
        capabilities: this.#browser.capabilities,
        actionSnapshots: this.#actionSnapshots.length
          ? this.#actionSnapshots
          : undefined,
        format: this.#options.traceFormat
      })
      log.info(`Trace saved to ${tracePath}`)
    } else {
      const traceFilePath = path.join(
        outputDir,
        `wdio-trace-${this.#browser.sessionId}.json`
      )
      await fs.writeFile(traceFilePath, JSON.stringify(traceLog))
      log.info(`DevTools trace saved to ${traceFilePath}`)
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
