import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import logger from '@wdio/logger'
import { WebSocket } from 'ws'
import { CONSOLE_METHODS, LOG_SOURCES, ANSI_REGEX, LOG_LEVEL_PATTERNS } from './constants.js'
import type { CommandLog, ConsoleLog, LogLevel, NightwatchBrowser } from './types.js'
import { getCapturePerformanceScript } from './helpers/capturePerformance.js'

const require = createRequire(import.meta.url)
const log = logger('@wdio/nightwatch-devtools:SessionCapturer')

/**
 * Strip ANSI escape codes from text
 */
const stripAnsiCodes = (text: string): string => text.replace(ANSI_REGEX, '')

/**
 * Detect log level from text content
 */
const detectLogLevel = (text: string): LogLevel => {
  const cleanText = stripAnsiCodes(text).toLowerCase()

  for (const { level, pattern } of LOG_LEVEL_PATTERNS) {
    if (pattern.test(cleanText)) {
      return level
    }
  }

  return 'log'
}

/**
 * Create a console log entry
 */
const createConsoleLogEntry = (
  type: LogLevel,
  args: any[],
  source: string
): ConsoleLog => ({
  timestamp: Date.now(),
  type,
  args,
  source
})

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
  #commandCounter = 0 // Sequential ID for commands
  #sentCommandIds = new Set<number>() // Track which commands have been sent

  commandsLog: CommandLog[] = []
  sources = new Map<string, string>()
  consoleLogs: ConsoleLog[] = []
  mutations: any[] = []
  traceLogs: string[] = []
  networkRequests: any[] = []
  metadata?: any

  constructor(devtoolsOptions: { hostname?: string; port?: number } = {}, browser?: NightwatchBrowser) {
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
    // Temporarily disable console patching to prevent infinite loops
    // We can re-enable this later with better filtering
    return

    CONSOLE_METHODS.forEach((method) => {
      const originalMethod = this.#originalConsoleMethods[method]
      console[method] = (...consoleArgs: any[]) => {
        // Skip capturing if we're already in a capture operation (prevent infinite recursion)
        if (this.#isCapturingConsole) {
          return originalMethod.apply(console, consoleArgs)
        }

        // Skip capturing internal framework logs (logger messages)
        const firstArg = String(consoleArgs[0] || '')
        if (firstArg.includes('@wdio/') || firstArg.includes('INFO') || firstArg.includes('WARN') || firstArg.includes('ERROR')) {
          return originalMethod.apply(console, consoleArgs)
        }

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

        // Set flag before capturing to prevent recursion
        this.#isCapturingConsole = true

        const logEntry = createConsoleLogEntry(
          method,
          serializedArgs,
          LOG_SOURCES.TEST
        )
        this.consoleLogs.push(logEntry)
        this.sendUpstream('consoleLogs', [logEntry])

        const result = originalMethod.apply(console, consoleArgs)

        // Reset flag after everything is done
        this.#isCapturingConsole = false
        return result
      }
    })
  }

  #interceptProcessStreams() {
    // Temporarily disable stream interception to prevent infinite loops
    // We can re-enable this later with better filtering
    return

    // Regex to detect spinner/progress characters
    const spinnerRegex = /[\u280b\u2819\u2839\u2838\u283c\u2834\u2826\u2827\u2807\u280f]/

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
          // Skip lines with spinner characters to avoid flooding logs
          if (spinnerRegex.test(line)) {
            return
          }

          // Strip ANSI codes and check if there's actual content
          const cleanedLine = stripAnsiCodes(line).trim()
          if (!cleanedLine) {
            return
          }

          const logEntry = createConsoleLogEntry(
            detectLogLevel(cleanedLine),
            [cleanedLine],
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
    const serializedError = error ? {
      name: error.name,
      message: error.message,
      stack: error.stack
    } : undefined

    const commandId = this.#commandCounter++
    const commandLogEntry: CommandLog & { _id?: number } = {
      _id: commandId, // Internal ID for tracking
      command,
      args,
      result,
      error: serializedError as any,
      timestamp: timestamp || Date.now(),
      callSource,
      testUid
    }

    // IMPORTANT: Push to commandsLog FIRST (synchronously)
    // so it's available immediately for sending
    this.commandsLog.push(commandLogEntry)

    // THEN do async performance capture for navigation commands
    const isNavigationCommand = ['url', 'navigate', 'navigateTo'].some(cmd =>
      command.toLowerCase().includes(cmd.toLowerCase())
    )

    if (isNavigationCommand && this.#browser && !error) {
      // Do this async work in the background without blocking
      // Update the commandLogEntry that's already in the array
      this.#capturePerformanceData(commandLogEntry, args).catch((err) => {
        console.log(`⚠️ Failed to capture performance data: ${(err as Error).message}`)
      })
    }

    return true
  }

  async #capturePerformanceData(commandLogEntry: CommandLog & { _id?: number }, args: any[]) {
    // Wait a bit for page to load
    await new Promise(resolve => setTimeout(resolve, 500))

    // Execute script to capture performance data
    // Nightwatch's execute() requires a function, not a string
    const performanceData = await this.#browser!.execute(function() {
      // @ts-ignore - executed in browser context
      const performance = window.performance;
      // @ts-ignore
      const navigation = performance.getEntriesByType?.('navigation')?.[0];
      // @ts-ignore
      const resources = performance.getEntriesByType?.('resource') || [];

      return {
        navigation: navigation ? {
          // @ts-ignore
          url: window.location.href,
          timing: {
            loadTime: navigation.loadEventEnd - navigation.fetchStart,
            domContentLoaded: navigation.domContentLoadedEventEnd - navigation.fetchStart,
            firstPaint: performance.getEntriesByType?.('paint')?.[0]?.startTime || 0
          }
        } : null,
        resources: resources.map((r: any) => ({
          name: r.name,
          type: r.initiatorType,
          size: r.transferSize || r.decodedBodySize || 0,
          duration: r.duration
        })),
        // @ts-ignore
        cookies: (function() {
          // @ts-ignore - executed in browser context
          try { return document.cookie; } catch (e) { return ''; }
        })(),
        documentInfo: {
          // @ts-ignore
          title: document.title,
          // @ts-ignore
          url: window.location.href,
          // @ts-ignore
          referrer: document.referrer
        }
      };
    })

    // Nightwatch returns {value: result} or just the result directly
    let data: any
    if (performanceData && typeof performanceData === 'object') {
      // Check if it has a 'value' property (WebDriver format)
      if ('value' in performanceData) {
        data = (performanceData as any).value
      } else {
        // It might be the data directly
        data = performanceData
      }
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

      console.log(`✓ Captured performance data: ${data.resources?.length || 0} resources, load time: ${data.navigation?.timing?.loadTime || 0}ms`)
    }
  }

  /**
   * Send a command to the UI (only if not already sent)
   */
  sendCommand(command: CommandLog & { _id?: number }) {
    if (command._id !== undefined && !this.#sentCommandIds.has(command._id)) {
      this.#sentCommandIds.add(command._id)
      // Remove internal ID before sending
      const { _id, ...commandToSend } = command
      this.sendUpstream('commands', [commandToSend])
    }
  }

  /**
   * Capture test source code
   */
  async captureSource(filePath: string) {
    if (!this.sources.has(filePath)) {
      try {
        const sourceCode = await fs.readFile(filePath, 'utf-8')
        this.sources.set(filePath, sourceCode.toString())
        this.sendUpstream('sources', { [filePath]: sourceCode.toString() })
      } catch (err) {
        log.warn(`Failed to read source file ${filePath}: ${(err as Error).message}`)
      }
    }
  }

  /**
   * Send data upstream to backend
   */
  sendUpstream(event: string, data: any) {
    // Check if WebSocket is open and ready
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
      // Use ORIGINAL process methods to avoid infinite recursion from console patching
      this.#originalProcessMethods.stderrWrite(`[SESSION] WebSocket not ready (state: ${this.#ws?.readyState}), cannot send ${event}\n`)
      return
    }

    try {
      // IMPORTANT: WDIO backend expects {scope, data} format, NOT {event, data}
      const payload = JSON.stringify({ scope: event, data })
      // Use ORIGINAL process methods instead of console.log to avoid recursion
      this.#originalProcessMethods.stdoutWrite(`[SESSION] Sending ${event} upstream, data size: ${payload.length} bytes\n`)
      this.#ws.send(payload)
    } catch (err) {
      this.#originalProcessMethods.stderrWrite(`[SESSION] Failed to send ${event}: ${(err as Error).message}\n`)
    }
  }

  /**
   * Check if WebSocket connection is still open
   * Used by the after() hook to wait for browser window close
   */
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

      log.info(`Script path: ${preloadScriptPath}`)
      log.info(`Script size: ${scriptContent.length} bytes`)

      // The script contains top-level await - wrap the entire script in async IIFE before injection
      scriptContent = `(async function() { ${scriptContent} })()`

      // Inject using script element - synchronous check after timeout
      const injectionScript = `
        const script = document.createElement('script');
        script.textContent = arguments[0];
        document.head.appendChild(script);
        return true;
      `

      const injectResult = await browser.execute(injectionScript, [scriptContent])
      log.info(`Injection command executed: ${JSON.stringify(injectResult)}`)

      // Wait for script to execute
      await browser.pause(300)

      // Check if collector exists using string-based execute
      const checkScript = 'return typeof window.wdioTraceCollector !== "undefined"'
      const checkResult = await browser.execute(checkScript)

      // Nightwatch wraps results in { value: ... }
      const hasCollector = (checkResult as any)?.value === true

      log.info(`Collector check result: ${JSON.stringify(checkResult)}, hasCollector: ${hasCollector}`)

      if (hasCollector) {
        log.info('✓ Devtools script injected successfully')
      } else {
        log.warn(`Script injection may have failed - collector not found`)
      }
    } catch (err) {
      log.error(`Failed to inject script: ${(err as Error).message}`)
      throw err
    }
  }

  /**
   * Capture trace data from the browser (network requests, console logs, etc.)
   */
  async captureTrace(browser: NightwatchBrowser) {
    try {
      // Check if the collector exists in the browser - access .value
      const checkResult = await browser.execute('return typeof window.wdioTraceCollector !== "undefined"')
      const collectorExists = (checkResult as any)?.value === true

      if (!collectorExists) {
        log.warn('wdioTraceCollector not found - script may not have been injected')
        return
      }

      // Get trace data from the collector - access .value
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

      const { mutations, traceLogs, consoleLogs, networkRequests, metadata } = traceData

      // Send network requests
      if (Array.isArray(networkRequests) && networkRequests.length > 0) {
        this.networkRequests.push(...networkRequests)
        this.sendUpstream('networkRequests', networkRequests)
        log.info(`✓ Captured ${networkRequests.length} network requests`)
      }

      // Send console logs from browser
      if (Array.isArray(consoleLogs) && consoleLogs.length > 0) {
        this.consoleLogs.push(...consoleLogs)
        this.sendUpstream('consoleLogs', consoleLogs)
      }

      // Send mutations
      if (Array.isArray(mutations) && mutations.length > 0) {
        this.mutations.push(...mutations)
        this.sendUpstream('mutations', mutations)
      }

      // Send trace logs
      if (Array.isArray(traceLogs) && traceLogs.length > 0) {
        this.traceLogs.push(...traceLogs)
        this.sendUpstream('logs', traceLogs)
      }

      // Update metadata
      if (metadata) {
        this.metadata = { ...this.metadata, ...metadata }
      }
    } catch (err) {
      log.error(`Failed to capture trace: ${(err as Error).message}`)
    }
  }
}
