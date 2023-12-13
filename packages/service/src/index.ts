/// <reference types="../../script/types.d.ts" />
import fs from 'node:fs/promises'
import path from 'node:path'

import logger from '@wdio/logger'
import { SevereServiceError } from 'webdriverio'
import type { Capabilities, Options } from '@wdio/types'
import type { WebDriverCommands } from '@wdio/protocols'
import type { Services, Reporters } from '@wdio/types'

import { SessionCapturer } from './session.js'
import { TestReporter } from './reporter.js'
import { DevToolsAppLauncher } from './launcher.js'
import { getBrowserObject } from './utils.ts'
import { type TraceLog, TraceType } from './types.ts'

export const launcher = DevToolsAppLauncher

const log = logger('@wdio/devtools-service')

/**
 * Setup WebdriverIO Devtools hook for standalone instances
 */
export function setupForDevtools (opts: Options.WebdriverIO) {
  let browserCaptured = false
  const service = new DevToolsHookService()
  service.beforeSession(null as never, opts.capabilities as Capabilities.RemoteCapability)

  /**
   * register before command hook
   */
  opts.beforeCommand = Array.isArray(opts.beforeCommand)
    ? opts.beforeCommand
    : opts.beforeCommand ? [opts.beforeCommand] : []
  opts.beforeCommand.push(
    async function captureBrowserInstance (this: WebdriverIO.Browser, command: keyof WebDriverCommands) {
      if (!browserCaptured) {
        browserCaptured = true
        service.before(null as never, null as never, this)
      }

      /**
       * capture trace on `deleteSession` since we can't do it in `afterCommand` as the session
       * would be terminated by then
       */
      if (command === 'deleteSession') {
        await service.after()
      }
    },
    service.beforeCommand.bind(service)
  )

  /**
   * register after command hook
   */
  opts.afterCommand = Array.isArray(opts.afterCommand)
    ? opts.afterCommand
    : opts.afterCommand ? [opts.afterCommand] : []
  opts.afterCommand.push(service.afterCommand.bind(service))

  /**
   * return modified session configuration
   */
  return opts
}

export default class DevToolsHookService implements Services.ServiceInstance {
  #testReporters: TestReporter[] = []
  #sessionCapturer = new SessionCapturer()
  #browser: WebdriverIO.Browser | undefined

  before (_: never, __: never, browser: WebdriverIO.Browser) {
    this.#browser = browser
  }

  beforeSession (config: Options.WebdriverIO | Options.Testrunner, capabilities: Capabilities.RemoteCapability) {
    /**
     * this service does not support multiremote yet
     */
    const mrCaps = Object.values(capabilities as Capabilities.MultiRemoteCapabilities)[0]
    if (typeof mrCaps === 'object' && 'capabilities' in mrCaps) {
      throw new SevereServiceError('The DevTools hook does not support multiremote yet')
    }

    /**
     * make sure to run with Bidi enabled by setting `webSocketUrl` to `true`
     */
    const w3cCaps = capabilities as Capabilities.W3CCapabilities
    const multiRemoteCaps = capabilities as Capabilities.MultiRemoteCapabilities
    const caps = w3cCaps.alwaysMatch
      ? w3cCaps.alwaysMatch
      : multiRemoteCaps[Object.keys(multiRemoteCaps)[0]].capabilities
        ? multiRemoteCaps[Object.keys(multiRemoteCaps)[0]].capabilities as WebdriverIO.Capabilities
        : capabilities as WebdriverIO.Capabilities
    caps.webSocketUrl = true

    if ('reporters' in config) {
      const self = this
      config.reporters = [
        ...(config.reporters || []),
        /**
         * class wrapper to make sure we can access the reporter instance
         */
        class DevToolsReporter extends TestReporter {
          constructor (options: Reporters.Options) {
            super(options)
            self.#testReporters.push(this)
          }
        }
      ]
    }
  }

  async beforeCommand() {
    if (!this.#browser) {
      return
    }
    await this.#sessionCapturer.injectScript(getBrowserObject(this.#browser))
  }

  afterCommand(command: keyof WebDriverCommands, args: any[], result: any, error: Error) {
    return this.#sessionCapturer.afterCommand(browser, command, args, result, error)
  }

  /**
   * after hook is triggered at the end of every worker session, therefore
   * we can use it to write all trace information to a file
   */
  async after () {
    if (!this.#browser) {
      return
    }
    const outputDir = this.#browser.options.outputDir || process.cwd()
    const { capabilities, ...options } = this.#browser.options as Options.WebdriverIO
    const traceLog: TraceLog = {
      mutations: this.#sessionCapturer.mutations,
      logs: this.#sessionCapturer.traceLogs,
      consoleLogs: this.#sessionCapturer.consoleLogs,
      metadata: {
        type: TraceType.Standalone,
        ...this.#sessionCapturer.metadata!,
        options,
        capabilities
      },
      commands: this.#sessionCapturer.commandsLog,
      sources: Object.fromEntries(this.#sessionCapturer.sources),
      suites: this.#testReporters.map((reporter) => reporter.report)
    }

    const traceFilePath = path.join(outputDir, `wdio-trace-${this.#browser.sessionId}.json`)
    await fs.writeFile(traceFilePath, JSON.stringify(traceLog))
    log.info(`DevTools trace saved to ${traceFilePath}`)
  }
}
