import fs from 'node:fs/promises'
import url from 'node:url'

import logger from '@wdio/logger'
import { parse } from 'stack-trace'
import { resolve } from 'import-meta-resolve'
import { SevereServiceError } from 'webdriverio'
import type { WebDriverCommands } from '@wdio/protocols'

import { PAGE_TRANSITION_COMMANDS } from './constants.js'
import {
  LOG_SOURCES,
  SessionCapturerBase,
  createConsoleLogEntry,
  getRequestType,
  type LogSource
} from '@wdio/devtools-core'
import type { CommandLog, LogLevel } from './types.js'

const log = logger('@wdio/devtools-service:SessionCapturer')

export class SessionCapturer extends SessionCapturerBase {
  #isScriptInjected = false
  #pendingNetworkRequests = new Map<
    string,
    {
      url: string
      method: string
      timestamp: number
      startTime: number
      requestHeaders?: Record<string, string>
    }
  >()

  // Captured session state exposed to service/index.ts for the final trace
  // payload (consumed in afterTest / before browser reloadSession).
  commandsLog: CommandLog[] = []
  sources = new Map<string, string>()
  mutations: TraceMutation[] = []
  traceLogs: string[] = []
  consoleLogs: ConsoleLogs[] = []
  networkRequests: NetworkRequest[] = []
  metadata?: {
    url: string
    viewport: {
      width: number
      height: number
      offsetLeft: number
      offsetTop: number
      scale: number
    }
  }

  constructor(devtoolsOptions: { hostname?: string; port?: number } = {}) {
    super(devtoolsOptions)
    this.patchConsole()
    this.patchStreams()
  }

  protected override onWsError(err: unknown): void {
    log.error(`Couldn't connect to devtools backend: ${(err as Error).message}`)
  }

  /**
   * Push every captured line into the local `consoleLogs` array so it ends up
   * in the final trace payload, in addition to the live WS broadcast.
   */
  protected override onLine(
    type: LogLevel,
    args: string[],
    source: LogSource
  ): void {
    const entry = createConsoleLogEntry(type, args, source)
    this.consoleLogs.push(entry as ConsoleLogs)
    this.sendUpstream('consoleLogs', [entry])
  }

  // Cucumber step files never appear on the WebDriver call stack;
  // the reporter feeds their paths here so the Source tab can resolve them.
  async ensureSourceLoaded(location?: string): Promise<void> {
    if (!location) {
      return
    }
    const absolutePath = location.startsWith('file://')
      ? url.fileURLToPath(location)
      : location
    const sourceFilePath = absolutePath.split(':')[0]
    if (!sourceFilePath || this.sources.has(sourceFilePath)) {
      return
    }
    try {
      const sourceCode = (await fs.readFile(sourceFilePath, 'utf-8')).toString()
      this.sources.set(sourceFilePath, sourceCode)
      this.sendUpstream('sources', { [sourceFilePath]: sourceCode })
    } catch {
      // file unreadable / missing — nothing to surface
    }
  }

  async afterCommand(
    browser: WebdriverIO.Browser,
    command: keyof WebDriverCommands,
    args: any[],
    result: any,
    error: Error | undefined,
    callSource?: string
  ) {
    const sourceFileLocation =
      parse(new Error(''))
        .filter((frame) => Boolean(frame.getFileName()))
        .map((frame) =>
          [
            frame.getFileName(),
            frame.getLineNumber(),
            frame.getColumnNumber()
          ].join(':')
        )
        .filter(
          (fileName) =>
            !fileName.includes('/node_modules/') &&
            !fileName.includes('<anonymous>)') &&
            !fileName.includes('node:internal') &&
            !fileName.includes('/dist/')
        )
        .shift() || ''
    const absolutePath = sourceFileLocation.startsWith('file://')
      ? url.fileURLToPath(sourceFileLocation)
      : sourceFileLocation
    const sourceFilePath = absolutePath.split(':')[0]
    const doesFileExist = await fs.access(sourceFilePath).then(
      () => true,
      () => false
    )
    if (
      sourceFileLocation &&
      !this.sources.has(sourceFileLocation) &&
      doesFileExist
    ) {
      const sourceCode = await fs.readFile(sourceFilePath, 'utf-8')
      this.sources.set(sourceFilePath, sourceCode.toString())
      this.sendUpstream('sources', { [sourceFilePath]: sourceCode.toString() })
    }
    const commandLogEntry: CommandLog = {
      command,
      args,
      result,
      error,
      timestamp: Date.now(),
      callSource: callSource ?? absolutePath
    }
    try {
      commandLogEntry.screenshot = await browser.takeScreenshot()
    } catch (screenshotError) {
      log.warn(
        `failed to capture screenshot: ${(screenshotError as Error).message}`
      )
    }
    this.commandsLog.push(commandLogEntry)
    this.sendUpstream('commands', [commandLogEntry])

    /**
     * capture trace and write to file on commands that could trigger a page transition
     */
    if (PAGE_TRANSITION_COMMANDS.includes(command)) {
      await this.#captureTrace(browser)
    }
  }

  async injectScript(browser: WebdriverIO.Browser) {
    if (this.#isScriptInjected) {
      log.info('Script already injected, skipping')
      return
    }

    if (!browser.isBidi) {
      throw new SevereServiceError(
        `Can not set up devtools for session with id "${browser.sessionId}" because it doesn't support WebDriver Bidi`
      )
    }

    this.#isScriptInjected = true
    log.info('Injecting devtools script...')
    const script = await resolve('@wdio/devtools-script', import.meta.url)
    const source = (await fs.readFile(url.fileURLToPath(script))).toString()
    const functionDeclaration = `async () => { ${source} }`

    await browser.scriptAddPreloadScript({
      functionDeclaration
    })
    log.info('✓ Script injected successfully')
  }

  async #captureTrace(browser: WebdriverIO.Browser) {
    if (!this.#isScriptInjected) {
      log.warn('Script not injected, skipping trace capture')
      return
    }

    try {
      const collectorExists = await browser.execute(
        () => typeof window.wdioTraceCollector !== 'undefined'
      )

      if (!collectorExists) {
        log.warn(
          'wdioTraceCollector not loaded yet - page loaded before preload script took effect'
        )
        return
      }

      const { mutations, traceLogs, consoleLogs, networkRequests, metadata } =
        await browser.execute(() => window.wdioTraceCollector.getTraceData())
      this.metadata = metadata

      if (Array.isArray(mutations)) {
        this.mutations.push(...(mutations as TraceMutation[]))
        this.sendUpstream('mutations', mutations)
      }
      if (Array.isArray(traceLogs)) {
        this.traceLogs.push(...traceLogs)
        this.sendUpstream('logs', traceLogs)
      }
      if (Array.isArray(consoleLogs)) {
        const browserLogs = consoleLogs as ConsoleLogs[]
        browserLogs.forEach((entry) => (entry.source = LOG_SOURCES.BROWSER))
        this.consoleLogs.push(...browserLogs)
        this.sendUpstream('consoleLogs', browserLogs)
      }
      if (Array.isArray(networkRequests)) {
        const requests = networkRequests as NetworkRequest[]
        this.networkRequests.push(...requests)
        this.sendUpstream('networkRequests', requests)
      }

      this.sendUpstream('metadata', metadata)
    } catch (err) {
      log.error(`Failed to capture trace: ${(err as Error).message}`)
    }
  }

  // Protocol-level capture survives pages that rewrite their own console.
  handleLogEntryAdded(event: {
    type?: 'console' | 'javascript'
    level?: 'debug' | 'info' | 'warn' | 'error'
    text?: string
    method?: string
    timestamp?: number
    args?: Array<{ type?: string; value?: unknown }>
  }) {
    const methodToType: Record<string, ConsoleLogs['type']> = {
      log: 'log',
      info: 'info',
      warn: 'warn',
      error: 'error',
      debug: 'log',
      trace: 'log'
    }
    const levelToType: Record<string, ConsoleLogs['type']> = {
      info: 'info',
      warn: 'warn',
      error: 'error',
      debug: 'log'
    }
    const type: ConsoleLogs['type'] =
      methodToType[event.method ?? ''] ??
      levelToType[event.level ?? ''] ??
      'log'

    const args: string[] = Array.isArray(event.args)
      ? event.args.map((a) => {
          if (a && 'value' in a && a.value !== undefined) {
            try {
              return typeof a.value === 'string'
                ? a.value
                : JSON.stringify(a.value)
            } catch {
              return String(a.value)
            }
          }
          return `[${a?.type ?? 'unknown'}]`
        })
      : event.text
        ? [event.text]
        : []

    const entry: ConsoleLogs = {
      timestamp:
        typeof event.timestamp === 'number' ? event.timestamp : Date.now(),
      type,
      args,
      source: LOG_SOURCES.BROWSER
    }
    this.consoleLogs.push(entry)
    this.sendUpstream('consoleLogs', [entry])
  }

  handleNetworkRequestStarted(event: {
    request: {
      request: string
      url: string
      method: string
      headers?: {
        name: string
        value: { type?: string; value?: string } | string
      }[]
    }
    timestamp: number
  }) {
    try {
      const { request, timestamp } = event
      const requestId = request.request
      const requestHeaders: Record<string, string> = {}
      if (request.headers) {
        request.headers.forEach(
          (h: {
            name: string
            value: { type?: string; value?: string } | string
          }) => {
            const name = typeof h.name === 'string' ? h.name.toLowerCase() : ''
            const value =
              typeof h.value === 'string'
                ? h.value
                : typeof h.value === 'object' && h.value?.value
                  ? h.value.value
                  : ''
            if (name) {
              requestHeaders[name] = value
            }
          }
        )
      }

      this.#pendingNetworkRequests.set(requestId, {
        url: request.url,
        method: request.method,
        timestamp,
        startTime: performance.now(),
        requestHeaders
      })
    } catch (err) {
      log.error(`handleNetworkRequestStarted error: ${err}`)
    }
  }

  handleNetworkResponseCompleted(event: {
    request: { request: string }
    response: {
      status?: number
      statusText?: string
      headers?: {
        name: string
        value: { type?: string; value?: string } | string
      }[]
      bytesReceived?: number
    }
    timestamp: number
  }) {
    try {
      const { request, response, timestamp } = event
      const requestId = request.request
      const pending = this.#pendingNetworkRequests.get(requestId)
      if (!pending) {
        return
      }

      this.#pendingNetworkRequests.delete(requestId)

      const responseHeaders: Record<string, string> = {}
      if (response.headers) {
        response.headers.forEach(
          (h: {
            name: string
            value: { type?: string; value?: string } | string
          }) => {
            const name = typeof h.name === 'string' ? h.name.toLowerCase() : ''
            const value =
              typeof h.value === 'string'
                ? h.value
                : typeof h.value === 'object' && h.value?.value
                  ? h.value.value
                  : ''
            if (name) {
              responseHeaders[name] = value
            }
          }
        )
      }

      const contentType = responseHeaders['content-type']?.trim()
      if (!contentType || contentType === '-') {
        return
      }

      const endTime = performance.now()
      const networkRequest: NetworkRequest = {
        id: `${timestamp}-${requestId}`,
        url: pending.url,
        method: pending.method,
        status: response.status,
        statusText: response.statusText,
        type: getRequestType(pending.url, contentType),
        timestamp: pending.timestamp,
        startTime: pending.startTime,
        endTime,
        time: endTime - pending.startTime,
        requestHeaders: pending.requestHeaders,
        responseHeaders,
        size: response.bytesReceived
      }

      this.networkRequests.push(networkRequest)
      this.sendUpstream('networkRequests', [networkRequest])
    } catch (err) {
      log.error(`handleNetworkResponseCompleted error: ${err}`)
    }
  }

  handleNetworkFetchError(event: { request: { request: string } }) {
    const requestId = event.request.request
    this.#pendingNetworkRequests.delete(requestId)
  }
}
