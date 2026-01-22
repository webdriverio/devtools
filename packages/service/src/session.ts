import fs from 'node:fs/promises'
import url from 'node:url'

import logger from '@wdio/logger'
import { WebSocket } from 'ws'
import { parse } from 'stack-trace'
import { resolve } from 'import-meta-resolve'
import { SevereServiceError } from 'webdriverio'
import type { WebDriverCommands } from '@wdio/protocols'

import {
  PAGE_TRANSITION_COMMANDS,
  ANSI_REGEX,
  CONSOLE_METHODS,
  LOG_LEVEL_PATTERNS,
  ERROR_INDICATORS,
  LOG_SOURCES
} from './constants.js'
import { type CommandLog, type TraceLog, type LogLevel } from './types.js'

const log = logger('@wdio/devtools-service:SessionCapturer')

/**
 * Generic helper to strip ANSI escape codes from text
 */
const stripAnsiCodes = (text: string): string => text.replace(ANSI_REGEX, '')

/**
 * Generic helper to detect log level from text content
 */
const detectLogLevel = (text: string): LogLevel => {
  const cleanText = stripAnsiCodes(text).toLowerCase()

  // Check log level patterns in priority order
  for (const { level, pattern } of LOG_LEVEL_PATTERNS) {
    if (pattern.test(cleanText)) {
      return level
    }
  }

  // Check for error indicators
  if (
    ERROR_INDICATORS.some((indicator) =>
      cleanText.includes(indicator.toLowerCase())
    )
  ) {
    return 'error'
  }

  return 'log'
}

/**
 * Generic helper to create a console log entry
 */
const createConsoleLogEntry = (
  type: LogLevel,
  args: any[],
  source: (typeof LOG_SOURCES)[keyof typeof LOG_SOURCES]
): ConsoleLogs => ({
  timestamp: Date.now(),
  type,
  args,
  source
})

export class SessionCapturer {
  #ws: WebSocket | undefined
  #isScriptInjected = false
  #originalConsoleMethods: Record<
    (typeof CONSOLE_METHODS)[number],
    typeof console.log
  >
  #originalProcessMethods: {
    stdoutWrite: typeof process.stdout.write
    stderrWrite: typeof process.stderr.write
  }
  #isCapturingConsole = false
  commandsLog: CommandLog[] = []
  sources = new Map<string, string>()
  mutations: TraceMutation[] = []
  traceLogs: string[] = []
  consoleLogs: ConsoleLogs[] = []
  networkRequests: NetworkRequest[] = []
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
  metadata?: {
    url: string
    viewport: VisualViewport
  }

  constructor(devtoolsOptions: { hostname?: string; port?: number } = {}) {
    const { port, hostname } = devtoolsOptions
    if (hostname && port) {
      this.#ws = new WebSocket(`ws://${hostname}:${port}/worker`)
      this.#ws.on('error', (err: unknown) =>
        log.error(
          `Couldn't connect to devtools backend: ${(err as Error).message}`
        )
      )
    }

    this.#originalConsoleMethods = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error
    }

    this.#originalProcessMethods = {
      stdoutWrite: process.stdout.write.bind(process.stdout),
      stderrWrite: process.stderr.write.bind(process.stderr)
    }

    this.#patchConsole()
    this.#interceptProcessStreams()
  }

  #patchConsole() {
    CONSOLE_METHODS.forEach((method) => {
      const originalMethod = this.#originalConsoleMethods[method]
      console[method] = (...consoleArgs: any[]) => {
        const serializedArgs = consoleArgs.map((arg) =>
          typeof arg === 'object' && arg !== null
            ? (() => {
                try {
                  return JSON.stringify(arg)
                } catch {
                  return String(arg)
                }
              })()
            : String(arg)
        )

        const logEntry = createConsoleLogEntry(
          method,
          serializedArgs,
          LOG_SOURCES.TEST
        )
        this.consoleLogs.push(logEntry)
        this.sendUpstream('consoleLogs', [logEntry])

        this.#isCapturingConsole = true
        const result = originalMethod.apply(console, consoleArgs)
        this.#isCapturingConsole = false
        return result
      }
    })
  }

  #interceptProcessStreams() {
    const captureTerminalOutput = (outputData: string | Uint8Array) => {
      const outputText =
        typeof outputData === 'string' ? outputData : outputData.toString()
      if (!outputText?.trim()) {
        return
      }

      outputText
        .split('\n')
        .filter((line) => line.trim())
        .forEach((line) => {
          const logEntry = createConsoleLogEntry(
            detectLogLevel(line),
            [stripAnsiCodes(line)],
            LOG_SOURCES.TERMINAL
          )
          this.consoleLogs.push(logEntry)
          this.sendUpstream('consoleLogs', [logEntry])
        })
    }

    const interceptStreamWrite = (
      stream: NodeJS.WriteStream,
      originalWriteMethod: (...args: any[]) => boolean
    ) => {
      const capturer = this
      stream.write = function (chunk: any, ...additionalArgs: any[]): boolean {
        const writeResult = originalWriteMethod.call(
          stream,
          chunk,
          ...additionalArgs
        )
        if (chunk && !capturer.#isCapturingConsole) {
          captureTerminalOutput(chunk)
        }
        return writeResult
      } as any
    }

    interceptStreamWrite(
      process.stdout,
      this.#originalProcessMethods.stdoutWrite
    )
    interceptStreamWrite(
      process.stderr,
      this.#originalProcessMethods.stderrWrite
    )
  }

  #restoreConsole() {
    CONSOLE_METHODS.forEach((method) => {
      console[method] = this.#originalConsoleMethods[method]
    })
  }

  cleanup() {
    this.#restoreConsole()
  }

  get isReportingUpstream() {
    return Boolean(this.#ws) && this.#ws?.readyState === WebSocket.OPEN
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
        browserLogs.forEach((log) => (log.source = LOG_SOURCES.BROWSER))
        this.consoleLogs.push(...browserLogs)
        this.sendUpstream('consoleLogs', browserLogs)
      }
      if (Array.isArray(networkRequests)) {
        const requests = networkRequests as NetworkRequest[]
        this.networkRequests.push(...requests)
        this.sendUpstream('networkRequests', requests)
      }

      this.sendUpstream('metadata', metadata)
      log.info(`✓ Sent metadata upstream, WS state: ${this.#ws?.readyState}`)
    } catch (err) {
      log.error(`Failed to capture trace: ${(err as Error).message}`)
    }
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
        type: this.#getRequestType(pending.url, contentType),
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

  #getRequestType(url: string, contentType?: string): string {
    const urlLower = url.toLowerCase()
    const ct = contentType?.toLowerCase() || ''

    if (ct.includes('text/html')) {
      return 'document'
    }
    if (ct.includes('text/css')) {
      return 'stylesheet'
    }
    if (ct.includes('javascript') || ct.includes('ecmascript')) {
      return 'script'
    }
    if (ct.includes('image/')) {
      return 'image'
    }
    if (ct.includes('font/') || ct.includes('woff')) {
      return 'font'
    }
    if (ct.includes('application/json')) {
      return 'fetch'
    }

    if (urlLower.endsWith('.html') || urlLower.endsWith('.htm')) {
      return 'document'
    }
    if (urlLower.endsWith('.css')) {
      return 'stylesheet'
    }
    if (urlLower.endsWith('.js') || urlLower.endsWith('.mjs')) {
      return 'script'
    }
    if (urlLower.match(/\.(png|jpg|jpeg|gif|svg|webp|ico)$/)) {
      return 'image'
    }
    if (urlLower.match(/\.(woff|woff2|ttf|eot|otf)$/)) {
      return 'font'
    }

    return 'xhr'
  }

  sendUpstream<Scope extends keyof TraceLog>(
    scope: Scope,
    data: Partial<TraceLog[Scope]>
  ) {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
      return
    }
    this.#ws.send(JSON.stringify({ scope, data }))
  }
}
