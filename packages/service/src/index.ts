/// <reference types="../../script/types.d.ts" />
import fs from 'node:fs/promises'
import path from 'node:path'

import logger from '@wdio/logger'
import { SevereServiceError } from 'webdriverio'
import type { Services, Reporters, Capabilities, Options } from '@wdio/types'
import type { WebDriverCommands } from '@wdio/protocols'

import { SessionCapturer } from './session.js'
import { TestReporter } from './reporter.js'
import { DevToolsAppLauncher } from './launcher.js'
import { getBrowserObject } from './utils.js'
import { parse } from 'stack-trace'
import { type TraceLog, TraceType } from './types.js'
import {
  INTERNAL_COMMANDS,
  SPEC_FILE_PATTERN,
  CONTEXT_CHANGE_COMMANDS
} from './constants.js'
export * from './types.js'
export const launcher = DevToolsAppLauncher

const log = logger('@wdio/devtools-service')

type CommandFrame = {
  command: string
  callSource?: string
}

/**
 * Setup WebdriverIO Devtools hook for standalone instances
 */
export function setupForDevtools(opts: Options.WebdriverIO) {
  let browserCaptured = false
  const service = new DevToolsHookService()
  service.captureType = TraceType.Standalone

  // In v9, the `opts` object itself contains the capabilities.
  // The `beforeSession` hook expects the config and the capabilities.
  service.beforeSession(opts, opts as Capabilities.W3CCapabilities)

  opts.beforeCommand = Array.isArray(opts.beforeCommand)
    ? opts.beforeCommand
    : opts.beforeCommand
      ? [opts.beforeCommand]
      : []
  opts.beforeCommand.push(async function captureBrowserInstance(
    this: WebdriverIO.Browser,
    command: keyof WebDriverCommands
  ) {
    if (!browserCaptured) {
      browserCaptured = true
      service.before(
        this.capabilities as Capabilities.W3CCapabilities,
        [],
        this
      )
    }

    /**
     * capture trace on `deleteSession` since we can't do it in `afterCommand` as the session
     * would be terminated by then
     */
    if (command === 'deleteSession') {
      await service.after()
    }
  }, service.beforeCommand.bind(service))

  /**
   * register after command hook
   */
  opts.afterCommand = Array.isArray(opts.afterCommand)
    ? opts.afterCommand
    : opts.afterCommand
      ? [opts.afterCommand]
      : []
  opts.afterCommand.push(service.afterCommand.bind(service))

  /**
   * return modified session configuration
   */
  return opts
}

export default class DevToolsHookService implements Services.ServiceInstance {
  #testReporters: TestReporter[] = []
  #sessionCapturer = new SessionCapturer()
  #browser?: WebdriverIO.Browser

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
      'wdio:devtoolsOptions'?: any
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
        `Failed to inject script at session start: ${(err as Error).message}`
      )
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

    if ('reporters' in config) {
      const self = this
      config.reporters = [
        ...(config.reporters || []),
        /**
         * class wrapper to make sure we can access the reporter instance
         */
        class DevToolsReporter extends TestReporter {
          constructor(options: Reporters.Options) {
            super(options, (upstreamData: any) =>
              self.#sessionCapturer.sendUpstream('suites', upstreamData)
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

  async beforeCommand(command: string, args: string[]) {
    if (!this.#browser) {
      return
    }

    /**
     * propagate url change to devtools app
     */
    if (command === 'url') {
      this.#sessionCapturer.sendUpstream('metadata', { url: args[0] })
    }

    /**
     * Smart stack filtering to detect top-level user commands
     */
    Error.stackTraceLimit = 20
    const stack = parse(new Error('')).reverse()
    const source = stack.find((frame) => {
      const file = frame.getFileName()
      // Only consider command frames from user spec/test files
      return file && SPEC_FILE_PATTERN.test(file)
    })

    if (
      source &&
      this.#commandStack.length === 0 &&
      !INTERNAL_COMMANDS.includes(command)
    ) {
      const rawFile = source.getFileName() ?? undefined
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

      const line = source.getLineNumber() ?? undefined
      const column = source.getColumnNumber() ?? undefined
      const callSource =
        absPath !== undefined
          ? `${absPath}:${line ?? 0}:${column ?? 0}`
          : undefined

      const cmdSig = JSON.stringify({
        command,
        args,
        src: callSource
      })

      if (this.#lastCommandSig !== cmdSig) {
        this.#commandStack.push({ command, callSource })
        this.#lastCommandSig = cmdSig
      }
    }
  }

  afterCommand(
    command: keyof WebDriverCommands,
    args: any[],
    result: any,
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
        return this.#sessionCapturer.afterCommand(
          this.#browser,
          command,
          args,
          result,
          error,
          frame.callSource
        )
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
    const outputDir = this.#browser.options.outputDir || process.cwd()
    const { ...options } = this.#browser.options
    const traceLog: TraceLog = {
      mutations: this.#sessionCapturer.mutations,
      logs: this.#sessionCapturer.traceLogs,
      consoleLogs: this.#sessionCapturer.consoleLogs,
      metadata: {
        type: this.captureType,
        ...this.#sessionCapturer.metadata!,
        options,
        capabilities: this.#browser.capabilities as Capabilities.W3CCapabilities
      },
      commands: this.#sessionCapturer.commandsLog,
      sources: Object.fromEntries(this.#sessionCapturer.sources),
      suites: this.#testReporters.map((reporter) => reporter.report)
    }

    const traceFilePath = path.join(
      outputDir,
      `wdio-trace-${this.#browser.sessionId}.json`
    )
    await fs.writeFile(traceFilePath, JSON.stringify(traceLog))
    log.info(`DevTools trace saved to ${traceFilePath}`)

    // Clean up console patching
    this.#sessionCapturer.cleanup()
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
        return Boolean((window as any).__WDIO_DEVTOOLS_MARK)
      })
      if (markerPresent) {
        return
      }
      await this.#sessionCapturer.injectScript(getBrowserObject(this.#browser))
    } catch (err) {
      log.warn(`[inject] failed (reason=${reason}): ${(err as Error).message}`)
    } finally {
      this.#injecting = false
    }
  }
}
