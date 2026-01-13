import fs from 'node:fs/promises'
import url from 'node:url'

import logger from '@wdio/logger'
import { WebSocket } from 'ws'
import { parse } from 'stack-trace'
import { resolve } from 'import-meta-resolve'
import { SevereServiceError } from 'webdriverio'
import type { WebDriverCommands } from '@wdio/protocols'

import { PAGE_TRANSITION_COMMANDS } from './constants.js'
import { type CommandLog } from './types.js'
import { type TraceLog } from './types.js'

const log = logger('@wdio/devtools-service:SessionCapturer')

export class SessionCapturer {
  #ws: WebSocket | undefined
  #isInjected = false
  #originalConsoleMethods: {
    log: typeof console.log
    info: typeof console.info
    warn: typeof console.warn
    error: typeof console.error
  }
  commandsLog: CommandLog[] = []
  sources = new Map<string, string>()
  mutations: TraceMutation[] = []
  traceLogs: string[] = []
  consoleLogs: ConsoleLogs[] = []
  networkRequests: NetworkRequest[] = []
  #pendingNetworkRequests = new Map<string, { url: string; method: string; timestamp: number; startTime: number; requestHeaders?: Record<string, string> }>()
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

    // Store original console methods
    this.#originalConsoleMethods = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error
    }

    // Patch console methods to capture test logs
    this.#patchConsole()
  }

  #patchConsole() {
    const consoleMethods = ['log', 'info', 'warn', 'error'] as const

    consoleMethods.forEach((method) => {
      const originalMethod = this.#originalConsoleMethods[method]
      console[method] = (...args: any[]) => {
        const logEntry: ConsoleLogs = {
          timestamp: Date.now(),
          type: method,
          args: args.map((arg) =>
            typeof arg === 'object' && arg !== null
              ? (() => {
                  try {
                    return JSON.stringify(arg)
                  } catch {
                    return String(arg)
                  }
                })()
              : String(arg)
          ),
          source: 'test'
        }
        this.consoleLogs.push(logEntry)
        this.sendUpstream('consoleLogs', [logEntry])
        return originalMethod.apply(console, args)
      }
    })
  }

  #restoreConsole() {
    console.log = this.#originalConsoleMethods.log
    console.info = this.#originalConsoleMethods.info
    console.warn = this.#originalConsoleMethods.warn
    console.error = this.#originalConsoleMethods.error
  }

  cleanup() {
    this.#restoreConsole()
    if (this.#ws) {
      this.#ws.close()
    }
  }

  get isReportingUpstream() {
    return Boolean(this.#ws) && this.#ws?.readyState === WebSocket.OPEN
  }

  /**
   * after command hook
   *
   * Used to
   *  - capture command logs
   *  - capture trace data from the application under test
   *
   * @param {string} command command name
   * @param {Array} args command arguments
   * @param {object} result command result
   * @param {Error} error command error
   */
  async afterCommand(
    browser: WebdriverIO.Browser,
    command: keyof WebDriverCommands,
    args: any[],
    result: any,
    error: Error | undefined,
    callSource?: string
  ) {
    const sourceFile =
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
    const absPath = sourceFile.startsWith('file://')
      ? url.fileURLToPath(sourceFile)
      : sourceFile
    const sourceFilePath = absPath.split(':')[0]
    const fileExist = await fs.access(sourceFilePath).then(
      () => true,
      () => false
    )
    if (sourceFile && !this.sources.has(sourceFile) && fileExist) {
      const sourceCode = await fs.readFile(sourceFilePath, 'utf-8')
      this.sources.set(sourceFilePath, sourceCode.toString())
      this.sendUpstream('sources', { [sourceFilePath]: sourceCode.toString() })
    }
    const newCommand: CommandLog = {
      command,
      args,
      result,
      error,
      timestamp: Date.now(),
      callSource: callSource ?? absPath
    }
    try {
      newCommand.screenshot = await browser.takeScreenshot()
    } catch (shotErr) {
      log.warn(`failed to capture screenshot: ${(shotErr as Error).message}`)
    }
    this.commandsLog.push(newCommand)
    this.sendUpstream('commands', [newCommand])

    /**
     * capture trace and write to file on commands that could trigger a page transition
     */
    if (PAGE_TRANSITION_COMMANDS.includes(command)) {
      await this.#captureTrace(browser)
    }
  }

  async injectScript(browser: WebdriverIO.Browser) {
    if (this.#isInjected) {
      log.info('Script already injected, skipping')
      return
    }

    if (!browser.isBidi) {
      throw new SevereServiceError(
        `Can not set up devtools for session with id "${browser.sessionId}" because it doesn't support WebDriver Bidi`
      )
    }

    this.#isInjected = true
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
    if (!this.#isInjected) {
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
        browserLogs.forEach((log) => (log.source = 'browser'))
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

  handleNetworkRequestStarted(event: { request: { request: string; url: string; method: string; headers?: { name: string; value: { type?: string; value?: string } | string }[] }; timestamp: number }) {
    try {
      const { request, timestamp } = event
      const requestId = request.request
      const requestHeaders: Record<string, string> = {}
      if (request.headers) {
        request.headers.forEach((h: { name: string; value: { type?: string; value?: string } | string }) => {
          const name = typeof h.name === 'string' ? h.name.toLowerCase() : ''
          const value = typeof h.value === 'string' ? h.value :
                       (typeof h.value === 'object' && h.value?.value) ? h.value.value : ''
          if (name) {
            requestHeaders[name] = value
          }
        })
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

handleNetworkResponseCompleted(event: { request: { request: string }; response: { status?: number; statusText?: string; headers?: { name: string; value: { type?: string; value?: string } | string }[]; bytesReceived?: number }; timestamp: number }) {
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
        response.headers.forEach((h: { name: string; value: { type?: string; value?: string } | string }) => {
          const name = typeof h.name === 'string' ? h.name.toLowerCase() : ''
          const value = typeof h.value === 'string' ? h.value :
                       (typeof h.value === 'object' && h.value?.value) ? h.value.value : ''
          if (name) {
            responseHeaders[name] = value
          }
        })
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

    if (ct.includes('text/html')) return 'document'
    if (ct.includes('text/css')) return 'stylesheet'
    if (ct.includes('javascript') || ct.includes('ecmascript')) return 'script'
    if (ct.includes('image/')) return 'image'
    if (ct.includes('font/') || ct.includes('woff')) return 'font'
    if (ct.includes('application/json')) return 'fetch'

    if (urlLower.endsWith('.html') || urlLower.endsWith('.htm')) return 'document'
    if (urlLower.endsWith('.css')) return 'stylesheet'
    if (urlLower.endsWith('.js') || urlLower.endsWith('.mjs')) return 'script'
    if (urlLower.match(/\.(png|jpg|jpeg|gif|svg|webp|ico)$/)) return 'image'
    if (urlLower.match(/\.(woff|woff2|ttf|eot|otf)$/)) return 'font'

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
