import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import logger from '@wdio/logger'
import { WebSocket } from 'ws'
import {
  CONSOLE_METHODS,
  LOG_SOURCES,
  NAVIGATION_COMMANDS,
  SPINNER_RE
} from './constants.js'
import {
  stripAnsiCodes,
  detectLogLevel,
  createConsoleLogEntry,
  chromeLogLevelToLogLevel,
  getRequestType
} from './helpers/utils.js'
import type {
  CommandLog,
  ConsoleLog,
  LogLevel,
  NightwatchBrowser
} from './types.js'

const require = createRequire(import.meta.url)
const log = logger('@wdio/nightwatch-devtools:SessionCapturer')

export class SessionCapturer {
  #ws: WebSocket | undefined
  #originalConsoleMethods: Record<
    (typeof CONSOLE_METHODS)[number],
    typeof console.log
  >
  #originalProcessMethods: {
    stdoutWrite: typeof process.stdout.write
    stderrWrite: typeof process.stderr.write
  }
  #isCapturingConsole = false
  #browser: NightwatchBrowser | undefined
#commandCounter = 0
  #sentCommandIds = new Set<number>()

  commandsLog: CommandLog[] = []
  sources = new Map<string, string>()
  consoleLogs: ConsoleLog[] = []
  mutations: any[] = []
  traceLogs: string[] = []
  networkRequests: any[] = []
  metadata?: any

  constructor(
    devtoolsOptions: { hostname?: string; port?: number } = {},
    browser?: NightwatchBrowser
  ) {
    const { port, hostname } = devtoolsOptions
    this.#browser = browser
    if (hostname && port) {
      this.#ws = new WebSocket(`ws://${hostname}:${port}/worker`)

      this.#ws.on('open', () => {
        log.info('✓ Worker WebSocket connected to backend')
      })

      this.#ws.on('error', (err: unknown) =>
        log.error(
          `Couldn't connect to devtools backend: ${(err as Error).message}`
        )
      )

      this.#ws.on('close', () => {
        log.info('Worker WebSocket disconnected')
      })
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
        this.#isCapturingConsole = true
        const result = originalMethod.apply(console, consoleArgs)
        this.#isCapturingConsole = false

        // Capture all console output; strip ANSI codes for clean display in UI
        const rawText = consoleArgs
          .map((a) => (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a)))
          .join(' ')
        const cleanText = stripAnsiCodes(rawText).trim()
        if (!cleanText) {
          return result
        }

        const logEntry = createConsoleLogEntry(
          method as LogLevel,
          [cleanText],
          LOG_SOURCES.TEST
        )
        this.consoleLogs.push(logEntry)
        this.sendUpstream('consoleLogs', [logEntry])

        return result
      }
    })
  }

  #isInternalStreamLine(line: string): boolean {
    const t = line.trim()
    return t.startsWith('{"') || t.includes('@wdio/devtools-backend') || t.startsWith('[SESSION]')
  }

  #isCapturingStream = false

  #interceptProcessStreams() {
    const captureTerminalOutput = (outputData: string | Uint8Array) => {
      if (this.#isCapturingStream) return
      const outputText =
        typeof outputData === 'string' ? outputData : outputData.toString()
      if (!outputText?.trim()) {
        return
      }

      this.#isCapturingStream = true
      try {
        const linesToCapture: string[] = []

        for (const rawLine of outputText.split('\n')) {
          const segments = rawLine.split('\r').filter((s) => s.trim())
          const lastSegment = segments[segments.length - 1] ?? rawLine
          const clean = stripAnsiCodes(lastSegment).trim()
          if (!clean || this.#isInternalStreamLine(clean) || SPINNER_RE.test(clean)) continue
          linesToCapture.push(clean)
        }

        for (const clean of linesToCapture) {
          const logEntry = createConsoleLogEntry(
            detectLogLevel(clean),
            [clean],
            LOG_SOURCES.TERMINAL
          )
          this.consoleLogs.push(logEntry)
          this.sendUpstream('consoleLogs', [logEntry])
        }
      } finally {
        this.#isCapturingStream = false
      }
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

  #restoreProcessStreams() {
    process.stdout.write = this.#originalProcessMethods.stdoutWrite as any
    process.stderr.write = this.#originalProcessMethods.stderrWrite as any
  }

  cleanup() {
    this.#restoreConsole()
    this.#restoreProcessStreams()
  }

  get isReportingUpstream() {
    return Boolean(this.#ws) && this.#ws?.readyState === WebSocket.OPEN
  }

  /**
   * Wait for WebSocket to connect
   */
  async waitForConnection(timeoutMs: number = 5000): Promise<boolean> {
    if (!this.#ws) {
      return false
    }

    if (this.#ws.readyState === WebSocket.OPEN) {
      return true
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        log.warn(`WebSocket connection timeout after ${timeoutMs}ms`)
        resolve(false)
      }, timeoutMs)

      this.#ws!.once('open', () => {
        clearTimeout(timeout)
        resolve(true)
      })

      this.#ws!.once('error', () => {
        clearTimeout(timeout)
        resolve(false)
      })
    })
  }

  /**
   * Capture a command execution
   * @returns true if command was captured, false if it was skipped as a duplicate
   */
  async captureCommand(
    command: string,
    args: any[],
    result: any,
    error: Error | undefined,
    testUid?: string,
    callSource?: string,
    timestamp?: number
  ): Promise<boolean> {
    // Serialize error properly (Error objects don't JSON.stringify well)
    const serializedError = error
      ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        }
      : undefined

    const commandId = this.#commandCounter++
    const commandLogEntry: CommandLog & { _id?: number } = {
      _id: commandId,
      command,
      args,
      result,
      error: serializedError as any,
      timestamp: timestamp || Date.now(),
      callSource,
      testUid
    }

    this.commandsLog.push(commandLogEntry)

    // Async performance capture for navigation commands
    const isNavigationCommand = NAVIGATION_COMMANDS.some((cmd) =>
      command.toLowerCase().includes(cmd.toLowerCase())
    )

    if (isNavigationCommand && this.#browser && !error) {
      // Do this async work in the background without blocking
      // Update the commandLogEntry that's already in the array
      this.#capturePerformanceData(commandLogEntry, args).catch((err) => {
        console.log(
          `⚠️ Failed to capture performance data: ${(err as Error).message}`
        )
      })
    }

    return true
  }

  async #capturePerformanceData(
    commandLogEntry: CommandLog & { _id?: number },
    args: any[]
  ) {
    // Wait a bit for page to load
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Execute script to capture performance data
    // Nightwatch's execute() requires a function, not a string
    const performanceData = await this.#browser!.execute(function () {
      // @ts-ignore - executed in browser context
      const performance = window.performance
      // @ts-ignore
      const navigation = performance.getEntriesByType?.('navigation')?.[0]
      // @ts-ignore
      const resources = performance.getEntriesByType?.('resource') || []

      return {
        navigation: navigation
          ? {
              // @ts-ignore
              url: window.location.href,
              timing: {
                loadTime: navigation.loadEventEnd - navigation.fetchStart,
                domContentLoaded:
                  navigation.domContentLoadedEventEnd - navigation.fetchStart,
                firstPaint:
                  performance.getEntriesByType?.('paint')?.[0]?.startTime || 0
              }
            }
          : null,
        resources: resources.map((r: any) => ({
          name: r.name,
          type: r.initiatorType,
          size: r.transferSize || r.decodedBodySize || 0,
          duration: r.duration
        })),
        // @ts-ignore
        cookies: (function () {
          try {
            // @ts-ignore
            return document.cookie;
          } catch {
            return '';
          }
        })(),
        documentInfo: {
          // @ts-ignore
          title: document.title,
          // @ts-ignore
          url: window.location.href,
          // @ts-ignore
          referrer: document.referrer
        }
      }
    })

    // Nightwatch returns {value: result} or just the result directly
    let data: any
    if (performanceData && typeof performanceData === 'object') {
      data = 'value' in performanceData ? (performanceData as any).value : performanceData
    }

    if (data && data.navigation) {
      commandLogEntry.performance = {
        navigation: data.navigation,
        resources: data.resources
      }
      commandLogEntry.cookies = data.cookies
      commandLogEntry.documentInfo = data.documentInfo

      // Always set result with performance data for consistency
      commandLogEntry.result = {
        url: args[0],
        loadTime: data.navigation?.timing?.loadTime,
        resources: data.resources,
        resourceCount: data.resources?.length,
        cookies: data.cookies,
        title: data.documentInfo?.title
      }

      log.info(`✓ Captured performance data: ${data.resources?.length || 0} resources, load time: ${data.navigation?.timing?.loadTime || 0}ms`)
    }
  }

  /** Send a command to the UI (only if not already sent) */
  sendCommand(command: CommandLog & { _id?: number }) {
    if (command._id !== undefined && !this.#sentCommandIds.has(command._id)) {
      this.#sentCommandIds.add(command._id)
      // Remove internal ID before sending
      const commandToSend = { ...command }
      delete commandToSend._id
      this.sendUpstream('commands', [commandToSend])
    }
  }

  /** Capture test source code */
  async captureSource(filePath: string) {
    if (!this.sources.has(filePath)) {
      try {
        const sourceCode = await fs.readFile(filePath, 'utf-8')
        this.sources.set(filePath, sourceCode.toString())
        this.sendUpstream('sources', { [filePath]: sourceCode.toString() })
      } catch (err) {
        log.warn(
          `Failed to read source file ${filePath}: ${(err as Error).message}`
        )
      }
    }
  }

  /** Send data upstream to backend */
  sendUpstream(event: string, data: any) {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
      return
    }

    try {
      this.#ws.send(JSON.stringify({ scope: event, data }))
    } catch {
      // ignore: WebSocket may close mid-flight
    }
  }

  /** Returns true when the WebSocket is open. */
  isConnected(): boolean {
    return this.#ws?.readyState === WebSocket.OPEN
  }

  /**
   * Inject the WDIO devtools script into the browser page
   */
  async injectScript(browser: NightwatchBrowser) {
    try {
      // Load the preload script
      const scriptPath = require.resolve('@wdio/devtools-script')
      const scriptDir = path.dirname(scriptPath)
      const preloadScriptPath = path.join(scriptDir, 'script.js')
      let scriptContent = await fs.readFile(preloadScriptPath, 'utf-8')

      // The script contains top-level await - wrap the entire script in async IIFE before injection
      scriptContent = `(async function() { ${scriptContent} })()`

      // Inject using script element - synchronous check after timeout
      const injectionScript = `
        const script = document.createElement('script');
        script.textContent = arguments[0];
        document.head.appendChild(script);
        return true;
      `

      const injectResult = await browser.execute(injectionScript, [
        scriptContent
      ])

      log.info(`Injection command executed: ${JSON.stringify(injectResult)}`)

      // Wait for script to execute
      await browser.pause(300)

      // Check if collector exists using string-based execute
      const checkScript =
        'return typeof window.wdioTraceCollector !== "undefined"'
      const checkResult = await browser.execute(checkScript)

      // Nightwatch wraps results in { value: ... }
      const hasCollector = (checkResult as any)?.value === true

      if (!hasCollector) {
        log.warn('Script injection may have failed - collector not found')
      }
    } catch (err) {
      log.error(`Failed to inject script: ${(err as Error).message}`)
      throw err
    }
  }

  /**
   * Capture Chrome DevTools browser console logs via WebDriver log API.
   * Requires loggingPrefs: { browser: 'ALL' } in Chrome capabilities.
   */
  async captureBrowserLogs(browser: NightwatchBrowser) {
    try {
      const rawLogs = await (browser as any).getLog('browser')
      const logs = ((rawLogs as any)?.value ?? rawLogs) as Array<{
        level: string
        message: string
        source: string
        timestamp: number
      }>

      if (!Array.isArray(logs) || logs.length === 0) {
        return
      }

      const entries: ConsoleLog[] = logs.map((entry) => ({
        timestamp: entry.timestamp,
        type: chromeLogLevelToLogLevel(entry.level),
        args: [entry.message],
        source: LOG_SOURCES.BROWSER
      }))

      this.consoleLogs.push(...entries)
      this.sendUpstream('consoleLogs', entries)
      log.info(`✓ Captured ${entries.length} browser console log entries`)
    } catch (err) {
      // Browser log capture not available (loggingPrefs not set or not supported)
    }
  }

  /**
   * Parse Chrome performance logs to extract network request entries.
   * Requires loggingPrefs: { performance: 'ALL' } in Chrome capabilities.
   */
  async captureNetworkFromPerformanceLogs(browser: NightwatchBrowser) {
    try {
      const rawLogs = await (browser as any).getLog('performance')
      const logs = ((rawLogs as any)?.value ?? rawLogs) as Array<{
        level: string
        message: string
        timestamp: number
      }>

      if (!Array.isArray(logs) || logs.length === 0) {
        return
      }

      // Parse CDP Network.* events from the performance log
      const pendingRequests = new Map<string, any>()
      const networkEntries: any[] = []

      for (const entry of logs) {
        try {
          const msg = JSON.parse(entry.message)
          const { method, params } = msg.message

          if (method === 'Network.requestWillBeSent') {
            const { requestId, request: req, timestamp } = params
            pendingRequests.set(requestId, {
              id: `${entry.timestamp}-${requestId}`,
              url: req.url,
              method: req.method,
              requestHeaders: req.headers,
              timestamp: Math.round(timestamp * 1000),
              startTime: entry.timestamp
            })
          } else if (method === 'Network.responseReceived') {
            const { requestId, response } = params
            const pending = pendingRequests.get(requestId)
            if (pending) {
              const responseHeaders: Record<string, string> = {}
              for (const [k, v] of Object.entries(response.headers || {})) {
                responseHeaders[k.toLowerCase()] = String(v)
              }
              pending.status = response.status
              pending.statusText = response.statusText
              pending.responseHeaders = responseHeaders
              pending.mimeType = response.mimeType
              pending.type = getRequestType(pending.url, response.mimeType)
            }
          } else if (method === 'Network.loadingFinished') {
            const { requestId, encodedDataLength } = params
            const pending = pendingRequests.get(requestId)
            if (pending && pending.status !== undefined) {
              pending.size = encodedDataLength
              pending.endTime = entry.timestamp
              pending.time = entry.timestamp - pending.startTime
              networkEntries.push({ ...pending })
              pendingRequests.delete(requestId)
            }
          } else if (method === 'Network.loadingFailed') {
            const { requestId, errorText } = params
            const pending = pendingRequests.get(requestId)
            if (pending) {
              pending.error = errorText
              pending.endTime = entry.timestamp
              pending.time = entry.timestamp - pending.startTime
              networkEntries.push({ ...pending })
              pendingRequests.delete(requestId)
            }
          }
        } catch {
          // skip malformed entries
        }
      }

      if (networkEntries.length > 0) {
        // Helper: for failed requests strip query string so that parallel
        // autocomplete/prefetch requests to the same path (e.g. /search?q=W,
        // /search?q=We, /search?q=Web…) collapse to a single entry.
        const failedKey = (entry: any): string => {
          try {
            const u = new URL(entry.url)
            return `err:${entry.method}:${u.origin}${u.pathname}`
          } catch {
            return `err:${entry.method}:${entry.url}`
          }
        }

        const alreadySeen = new Set(
          this.networkRequests.map((r: any) =>
            r.error !== undefined
              ? failedKey(r)
              : `ok:${r.method}:${r.url}:${r.timestamp}`
          )
        )

        const deduped: any[] = []
        const seenFailedInBatch = new Map<string, number>()

        for (const entry of networkEntries) {
          if (entry.error !== undefined) {
            const key = failedKey(entry)
            if (alreadySeen.has(key)) continue
            const existing = seenFailedInBatch.get(key)
            if (existing !== undefined) {
              deduped[existing] = entry  // replace with latest failure
            } else {
              seenFailedInBatch.set(key, deduped.length)
              deduped.push(entry)
            }
          } else {
            const key = `ok:${entry.method}:${entry.url}:${entry.timestamp}`
            if (!alreadySeen.has(key)) {
              deduped.push(entry)
            }
          }
        }

        this.networkRequests.push(...deduped)
        this.sendUpstream('networkRequests', deduped)
      }
    } catch (err) {
      const msg = (err as Error).message ?? ''
      // Silently skip when performance logging was not enabled in capabilities
      if (!msg.includes('log type') && !msg.includes('performance')) {
        log.warn(`Performance log capture failed: ${msg}`)
      }
    }
  }

  /**
   * Capture trace data from the browser (network requests, console logs, etc.)
   */
  async captureTrace(browser: NightwatchBrowser) {
    // Capture network requests from Chrome performance logs
    await this.captureNetworkFromPerformanceLogs(browser)

    // Also try the injected wdioTraceCollector script for XHR/fetch and mutations
    try {
      const checkResult = await browser.execute(
        'return typeof window.wdioTraceCollector !== "undefined"'
      )
      const collectorExists = (checkResult as any)?.value === true

      if (!collectorExists) {
        return
      }

      const result = await browser.execute(`
        if (typeof window.wdioTraceCollector === 'undefined') {
          return null;
        }
        return window.wdioTraceCollector.getTraceData();
      `)

      const traceData = (result as any)?.value
      if (!traceData) {
        return
      }

      const { mutations, traceLogs, consoleLogs, networkRequests, metadata } =
        traceData

      if (Array.isArray(consoleLogs) && consoleLogs.length > 0) {
        // Tag as browser source
        const tagged = consoleLogs.map((e: any) => ({
          ...e,
          source: LOG_SOURCES.BROWSER
        }))
        this.consoleLogs.push(...tagged)
        this.sendUpstream('consoleLogs', tagged)
      }

      if (Array.isArray(networkRequests) && networkRequests.length > 0) {
        this.networkRequests.push(...networkRequests)
        this.sendUpstream('networkRequests', networkRequests)
      }

      if (Array.isArray(mutations) && mutations.length > 0) {
        this.mutations.push(...mutations)
        this.sendUpstream('mutations', mutations)
      }

      if (Array.isArray(traceLogs) && traceLogs.length > 0) {
        this.traceLogs.push(...traceLogs)
        this.sendUpstream('logs', traceLogs)
      }

      if (metadata) {
        this.metadata = { ...this.metadata, ...metadata }
      }
    } catch (err) {
      log.error(`Failed to capture trace from injected script: ${(err as Error).message}`)
    }
  }
}
