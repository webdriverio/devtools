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

const stripAnsi = (text: string) => text.replace(ANSI_REGEX, '')

const detectLogLevel = (text: string): LogLevel => {
  const t = stripAnsi(text).toLowerCase()
  for (const { level, pattern } of LOG_LEVEL_PATTERNS) {
    if (pattern.test(t)) {
      return level
    }
  }
  if (ERROR_INDICATORS.some((i) => t.includes(i.toLowerCase()))) {
    return 'error'
  }
  return 'log'
}

const toConsoleEntry = (
  type: LogLevel,
  args: any[],
  source: (typeof LOG_SOURCES)[keyof typeof LOG_SOURCES]
): ConsoleLogs => ({ timestamp: Date.now(), type, args, source })

export class SessionCapturer {
  #ws: WebSocket | undefined
  #isScriptInjected = false
  #originalConsoleMethods: Record<
    (typeof CONSOLE_METHODS)[number],
    typeof console.log
  > = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error
  }
  #originalStdoutWrite = process.stdout.write.bind(process.stdout)
  #originalStderrWrite = process.stderr.write.bind(process.stderr)
  /** True while we are inside the patched console call — prevents double-capture via stream. */
  #insideConsole = false
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
    viewport: {
      width: number
      height: number
      offsetLeft: number
      offsetTop: number
      scale: number
    }
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

    this.#patchConsole()
    this.#patchStreams()
  }

  /**
   * Patch Node.js console methods so every console.log/info/warn/error call in
   * the test runner process (test files, page-object helpers, etc.) is forwarded
   * to the UI Console tab with source='test'.
   */
  #patchConsole() {
    CONSOLE_METHODS.forEach((method) => {
      const original = this.#originalConsoleMethods[method]
      console[method] = (...args: any[]) => {
        const serialized = args.map((a) =>
          typeof a === 'object' && a !== null
            ? (() => {
                try {
                  return JSON.stringify(a)
                } catch {
                  return String(a)
                }
              })()
            : String(a)
        )
        const entry = toConsoleEntry(method, serialized, LOG_SOURCES.TEST)
        this.consoleLogs.push(entry)
        this.sendUpstream('consoleLogs', [entry])

        this.#insideConsole = true
        const result = original.apply(console, args)
        this.#insideConsole = false
        return result
      }
    })
  }

  /**
   * Patch process.stdout / process.stderr so all terminal output (WDIO
   * framework logs, reporter output, etc.) is also forwarded to the UI
   * Console tab with source='terminal'.  The original write is always
   * called first so actual terminal output is never suppressed.
   */
  #patchStreams() {
    const forward = (raw: string | Uint8Array) => {
      const text = typeof raw === 'string' ? raw : raw.toString()
      if (!text.trim()) {
        return
      }
      text
        .split('\n')
        .filter((l) => l.trim())
        .forEach((line) => {
          const entry = toConsoleEntry(
            detectLogLevel(line),
            [stripAnsi(line)],
            LOG_SOURCES.TERMINAL
          )
          this.consoleLogs.push(entry)
          this.sendUpstream('consoleLogs', [entry])
        })
    }

    const wrap = (
      stream: NodeJS.WriteStream,
      original: (...a: any[]) => boolean
    ) => {
      stream.write = ((chunk: any, ...rest: any[]): boolean => {
        const result = original.call(stream, chunk, ...rest)
        if (chunk && !this.#insideConsole) {
          forward(chunk)
        }
        return result
      }) as any
    }

    wrap(process.stdout, this.#originalStdoutWrite)
    wrap(process.stderr, this.#originalStderrWrite)
  }

  /**
   * Restore all patched methods. Must be called in after() so subsequent
   * test runs (or the WDIO reporter teardown) see the real stdout/stderr.
   */
  cleanup() {
    CONSOLE_METHODS.forEach((method) => {
      console[method] = this.#originalConsoleMethods[method]
    })
    process.stdout.write = this.#originalStdoutWrite as any
    process.stderr.write = this.#originalStderrWrite as any
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
