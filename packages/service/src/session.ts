import fs from 'node:fs/promises'
import url from 'node:url'

import logger from '@wdio/logger'
import { parse } from 'stack-trace'
import { resolve } from 'import-meta-resolve'
import { SevereServiceError } from 'webdriverio'
import type { WebDriverCommands } from '@wdio/protocols'

import { PAGE_TRANSITION_COMMANDS } from './constants.js'
import {
  CAPTURE_PERFORMANCE_SCRIPT,
  LOG_SOURCES,
  SessionCapturerBase,
  applyPerformanceData,
  createConsoleLogEntry,
  errorMessage,
  getRequestType,
  type CapturedPerformancePayload,
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

  constructor(devtoolsOptions: { hostname?: string; port?: number } = {}) {
    super(devtoolsOptions)
    this.patchConsole()
    this.patchStreams()
  }

  protected override onWsError(err: unknown): void {
    log.error(`Couldn't connect to devtools backend: ${errorMessage(err)}`)
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
    if (!sourceFilePath) {
      return
    }
    await this.captureSource(sourceFilePath)
  }

  #resolveUserStackFrame(): {
    sourceFileLocation: string
    absolutePath: string
  } {
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
    return { sourceFileLocation, absolutePath }
  }

  async afterCommand(
    browser: WebdriverIO.Browser,
    command: keyof WebDriverCommands,
    args: unknown[],
    result: unknown,
    error: Error | undefined,
    callSource?: string
  ) {
    const { sourceFileLocation, absolutePath } = this.#resolveUserStackFrame()
    const sourceFilePath = absolutePath.split(':')[0]
    if (sourceFileLocation && sourceFilePath) {
      await this.captureSource(sourceFilePath)
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
    // Capture trace + perf on commands that could trigger a page transition.
    if (PAGE_TRANSITION_COMMANDS.includes(command)) {
      await this.#capturePerformance(browser, commandLogEntry, args)
      await this.#captureTrace(browser)
    }
  }

  /**
   * Run the shared Performance API capture script and attach the result to
   * the given CommandLog entry. Same `CAPTURE_PERFORMANCE_SCRIPT` +
   * `applyPerformanceData` selenium and nightwatch use, so the dashboard
   * shows consistent navigation/resources/cookies across all three adapters.
   */
  async #capturePerformance(
    browser: WebdriverIO.Browser,
    entry: CommandLog,
    args: unknown[]
  ): Promise<void> {
    try {
      // Brief settle so navigation entries are populated before we read them.
      await new Promise((resolve) => setTimeout(resolve, 500))
      const payload = (await browser.execute(CAPTURE_PERFORMANCE_SCRIPT)) as
        | CapturedPerformancePayload
        | undefined
      if (applyPerformanceData(entry, payload, args[0] as string | undefined)) {
        this.sendUpstream('commands', [entry])
      }
    } catch (err) {
      const msg = errorMessage(err)
      // Session torn down between the navigation command and the deferred
      // perf-script execution — expected during teardown of the last test.
      if (
        msg.includes('ECONNREFUSED') ||
        msg.includes('no such session') ||
        msg.includes('invalid session id')
      ) {
        return
      }
      log.warn(`Performance capture failed: ${msg}`)
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

      const payload = await browser.execute(() =>
        window.wdioTraceCollector.getTraceData()
      )
      this.processTracePayload(payload as Record<string, unknown>)
    } catch (err) {
      log.error(`Failed to capture trace: ${errorMessage(err)}`)
    }
  }

  // Protocol-level capture survives pages that rewrite their own console.
  #stringifyBidiLogArg(
    a: { type?: string; value?: unknown } | undefined
  ): string {
    if (a && 'value' in a && a.value !== undefined) {
      try {
        return typeof a.value === 'string' ? a.value : JSON.stringify(a.value)
      } catch {
        return String(a.value)
      }
    }
    return `[${a?.type ?? 'unknown'}]`
  }

  #mapBidiLogType(method?: string, level?: string): ConsoleLogs['type'] {
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
    return methodToType[method ?? ''] ?? levelToType[level ?? ''] ?? 'log'
  }

  handleLogEntryAdded(event: {
    type?: 'console' | 'javascript'
    level?: 'debug' | 'info' | 'warn' | 'error'
    text?: string
    method?: string
    timestamp?: number
    args?: Array<{ type?: string; value?: unknown }>
  }) {
    const type = this.#mapBidiLogType(event.method, event.level)
    const args: string[] = Array.isArray(event.args)
      ? event.args.map((a) => this.#stringifyBidiLogArg(a))
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

  #flattenBidiHeaders(
    headers:
      | {
          name: string
          value: { type?: string; value?: string } | string
        }[]
      | undefined
  ): Record<string, string> {
    const out: Record<string, string> = {}
    if (!headers) {
      return out
    }
    for (const h of headers) {
      const name = typeof h.name === 'string' ? h.name.toLowerCase() : ''
      const value =
        typeof h.value === 'string'
          ? h.value
          : typeof h.value === 'object' && h.value?.value
            ? h.value.value
            : ''
      if (name) {
        out[name] = value
      }
    }
    return out
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
      const responseHeaders = this.#flattenBidiHeaders(response.headers)
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
