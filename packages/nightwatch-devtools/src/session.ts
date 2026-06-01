import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'
import logger from '@wdio/logger'
import { WebSocket } from 'ws'
import {
  SessionCapturerBase,
  createConsoleLogEntry,
  serializeError,
  type LogSource
} from '@wdio/devtools-core'
import { LOG_SOURCES, NAVIGATION_COMMANDS } from './constants.js'
import { chromeLogLevelToLogLevel, getRequestType } from './helpers/utils.js'
import { CAPTURE_PERFORMANCE_SCRIPT } from './helpers/capturePerformance.js'
import type {
  CommandLog,
  ConsoleLog,
  LogLevel,
  NightwatchBrowser
} from './types.js'

const require = createRequire(import.meta.url)
const log = logger('@wdio/nightwatch-devtools:SessionCapturer')

export class SessionCapturer extends SessionCapturerBase {
  #browser: NightwatchBrowser | undefined

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
    super(devtoolsOptions)
    this.#browser = browser
    this.patchConsole()
    this.patchStreams()
  }

  protected override onWsOpen(): void {
    log.info('✓ Worker WebSocket connected to backend')
  }

  protected override onWsError(err: unknown): void {
    log.error(`Couldn't connect to devtools backend: ${(err as Error).message}`)
  }

  protected override onWsClose(): void {
    log.info('Worker WebSocket disconnected')
  }

  /**
   * Push every captured line into the local `consoleLogs` array so it ends up
   * in any future trace export, in addition to the live WS broadcast.
   */
  protected override onLine(
    type: LogLevel,
    args: string[],
    source: LogSource
  ): void {
    const entry = createConsoleLogEntry(type, args, source)
    this.consoleLogs.push(entry)
    this.sendUpstream('consoleLogs', [entry])
  }

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
    const serializedError = serializeError(error)

    const commandId = this.commandCounter++
    const commandLogEntry: CommandLog & { _id?: number } = {
      _id: commandId,
      command,
      args,
      result,
      error: serializedError,
      timestamp: timestamp || Date.now(),
      callSource,
      testUid
    }

    this.commandsLog.push(commandLogEntry)

    const isNavigationCommand = NAVIGATION_COMMANDS.some((cmd) =>
      command.toLowerCase().includes(cmd.toLowerCase())
    )
    if (isNavigationCommand && this.#browser && !error) {
      this.#capturePerformanceData(commandLogEntry, args).catch((err) => {
        log.warn(
          `Failed to capture performance data: ${(err as Error).message}`
        )
      })
    }

    return true
  }

  async #capturePerformanceData(
    commandLogEntry: CommandLog & { _id?: number },
    args: any[]
  ) {
    await new Promise((resolve) => setTimeout(resolve, 500))

    const performanceData = await this.#browser!.execute(
      CAPTURE_PERFORMANCE_SCRIPT
    )

    let data: any
    if (performanceData && typeof performanceData === 'object') {
      data =
        'value' in performanceData
          ? (performanceData as any).value
          : performanceData
    }

    if (data && data.navigation) {
      commandLogEntry.performance = {
        navigation: data.navigation,
        resources: data.resources
      }
      commandLogEntry.cookies = data.cookies
      commandLogEntry.documentInfo = data.documentInfo
      commandLogEntry.result = {
        url: args[0],
        loadTime: data.navigation?.timing?.loadTime,
        resources: data.resources,
        resourceCount: data.resources?.length,
        cookies: data.cookies,
        title: data.documentInfo?.title
      }
    }
  }

  /** Send a command to the UI (only if not already sent). Returns the id. */
  override sendCommand(command: CommandLog & { _id?: number }): number {
    if (command._id !== undefined && !this.sentCommandIds.has(command._id)) {
      this.sentCommandIds.add(command._id)
      // Remove internal ID before sending
      const commandToSend = { ...command }
      delete commandToSend._id
      this.sendUpstream('commands', [commandToSend])
    }
    return command._id ?? 0
  }

  /**
   * Replace an already-captured command entry (used for retried commands so
   * only the final execution result is shown in the UI).
   * Removes the old entry from commandsLog, revokes its sent-status so the
   * replacement can be sent, and returns the new entry together with the
   * old entry's timestamp (so the UI can locate and replace it in-place).
   */
  replaceCommand(
    oldId: number,
    command: string,
    args: any[],
    result: any,
    error: Error | undefined,
    testUid?: string,
    callSource?: string,
    timestamp?: number
  ): { entry: CommandLog & { _id?: number }; oldTimestamp: number } {
    // Remove the superseded entry and capture its timestamp for the UI
    const idx = this.commandsLog.findIndex((c: any) => c._id === oldId)
    const oldTimestamp: number =
      idx !== -1 ? ((this.commandsLog[idx] as any).timestamp ?? 0) : 0
    if (idx !== -1) {
      this.commandsLog.splice(idx, 1)
    }
    // Allow the slot to be re-used by a new entry
    this.sentCommandIds.delete(oldId)

    const serializedError = serializeError(error)
    const commandId = this.commandCounter++
    const entry: CommandLog & { _id?: number } = {
      _id: commandId,
      command,
      args,
      result,
      error: serializedError,
      timestamp: timestamp || Date.now(),
      callSource,
      testUid
    }
    this.commandsLog.push(entry)
    return { entry, oldTimestamp }
  }

  /**
   * Take a screenshot by calling the WebDriver HTTP endpoint directly.
   * This completely bypasses Nightwatch's command queue so there is no risk
   * of the request being appended after `end()` / `quit()`.
   */
  takeScreenshotViaHttp(browser: NightwatchBrowser): Promise<string | null> {
    const browserAny = browser as any
    const sessionId = browserAny.sessionId
    if (!sessionId) {
      return Promise.resolve(null)
    }

    const pick = (obj: any, ...keys: string[]): any => {
      if (!obj || typeof obj !== 'object') {
        return undefined
      }
      for (const k of keys) {
        const val = obj[k]
        if (val !== undefined && val !== null) {
          return val
        }
      }
      return undefined
    }

    const transportSettings =
      browserAny.transport?.settings?.webdriver ||
      browserAny.queue?.transport?.settings?.webdriver ||
      browserAny.nightwatchInstance?.transport?.settings?.webdriver ||
      {}

    const opts = browserAny.options || {}
    const nightwatchSettings =
      browserAny.nightwatchInstance?.settings ||
      browserAny.globals?.nightwatchInstance?.settings ||
      {}

    const driverHost: string =
      pick(transportSettings, 'host', 'server_address') ||
      pick(opts.webdriver, 'host') ||
      pick(nightwatchSettings.webdriver, 'host') ||
      'localhost'

    const driverPort: number =
      pick(transportSettings, 'port') ||
      pick(opts.webdriver, 'port') ||
      pick(nightwatchSettings.webdriver, 'port') ||
      9515

    const endpoint = `http://${driverHost}:${driverPort}/session/${sessionId}/screenshot`

    return new Promise((resolve) => {
      const req = http.get(endpoint, (res) => {
        let body = ''
        res.on('data', (chunk: string | Buffer) => {
          body += chunk
        })
        res.on('end', () => {
          try {
            const value = JSON.parse(body).value || null
            if (!value) {
              log.warn(`[screenshot] Empty response from ${endpoint}`)
            }
            resolve(value)
          } catch {
            log.warn(`[screenshot] Failed to parse response from ${endpoint}`)
            resolve(null)
          }
        })
      })
      req.on('error', (err) => {
        log.warn(
          `[screenshot] HTTP request failed (${endpoint}): ${(err as Error).message}`
        )
        resolve(null)
      })
      req.setTimeout(5000, () => {
        log.warn(`[screenshot] Request timed out (${endpoint})`)
        req.destroy()
        resolve(null)
      })
    })
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

  /**
   * Override base's `sendUpstream` to add nightwatch-specific diagnostics:
   * warns once the WS disconnects mid-run (so dropped events are visible),
   * and catches send errors instead of throwing.
   */
  override sendUpstream(event: string, data: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (this.hasEverConnected()) {
        log.warn(`[upstream] WebSocket not open — dropping "${event}" event`)
      }
      return
    }
    try {
      this.ws.send(JSON.stringify({ scope: event, data }))
    } catch (err) {
      log.warn(
        `[upstream] Failed to send "${event}": ${(err as Error).message}`
      )
    }
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

      await browser.execute(injectionScript, [scriptContent])

      // Poll for collector — the async IIFE may take a moment to initialise
      let hasCollector = false
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        const checkResult = await browser.execute(
          'return typeof window.wdioTraceCollector !== "undefined"'
        )
        hasCollector = ((checkResult as any)?.value ?? checkResult) === true
        if (hasCollector) {
          break
        }
      }

      if (hasCollector) {
        log.info('✓ Script injected and collector ready')
      } else {
        log.warn('Script injection may have failed — collector not found')
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
    } catch {
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
            if (alreadySeen.has(key)) {
              continue
            }
            const existing = seenFailedInBatch.get(key)
            if (existing !== undefined) {
              deduped[existing] = entry // replace with latest failure
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
      const collectorExists =
        ((checkResult as any)?.value ?? checkResult) === true

      if (!collectorExists) {
        return
      }

      const result = await browser.execute(`
        if (typeof window.wdioTraceCollector === 'undefined') {
          return null;
        }
        return window.wdioTraceCollector.getTraceData();
      `)

      const traceData = (result as any)?.value ?? result
      if (!traceData) {
        return
      }

      const { mutations, traceLogs, consoleLogs, networkRequests, metadata } =
        traceData

      if (metadata) {
        this.metadata = { ...this.metadata, ...metadata }
        this.sendUpstream('metadata', this.metadata)
      }

      if (Array.isArray(consoleLogs) && consoleLogs.length > 0) {
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
        log.info(`[trace] Captured ${mutations.length} DOM mutation(s)`)
      }

      if (Array.isArray(traceLogs) && traceLogs.length > 0) {
        this.traceLogs.push(...traceLogs)
        this.sendUpstream('logs', traceLogs)
      }

      if (Array.isArray(networkRequests) && networkRequests.length > 0) {
        log.info(
          `[trace] Captured ${networkRequests.length} network request(s)`
        )
      }
    } catch (err) {
      log.error(
        `Failed to capture trace from injected script: ${(err as Error).message}`
      )
    }
  }
}
