import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import logger from '@wdio/logger'
import { WebSocket } from 'ws'
import { serializeError } from '@wdio/devtools-core'
import { WS_PATHS } from '@wdio/devtools-shared'
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
  chromeLogLevelToLogLevel
} from './helpers/utils.js'
import { getDriverOriginals } from './driverPatcher.js'
import type {
  CommandLog,
  ConsoleLog,
  LogLevel,
  SeleniumDriverLike
} from './types.js'

const require = createRequire(import.meta.url)
const log = logger('@wdio/selenium-devtools:SessionCapturer')

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
  #isCapturingStream = false
  #hasConnected = false
  #driver: SeleniumDriverLike | undefined
  #commandCounter = 0
  #sentCommandIds = new Set<number>()

  // True once BiDi inspectors are attached — script-trace path skips streams.
  bidiActive = false
  #clientConnected = false
  #clientConnectedWaiters: Array<() => void> = []
  #onClientDisconnected?: () => void

  commandsLog: CommandLog[] = []
  sources = new Map<string, string>()
  consoleLogs: ConsoleLog[] = []
  mutations: any[] = []
  traceLogs: string[] = []
  networkRequests: any[] = []
  metadata?: any

  constructor(
    devtoolsOptions: { hostname?: string; port?: number } = {},
    driver?: SeleniumDriverLike
  ) {
    const { port, hostname } = devtoolsOptions
    this.#driver = driver
    if (hostname && port) {
      this.#ws = new WebSocket(`ws://${hostname}:${port}${WS_PATHS.worker}`)

      this.#ws.on('open', () => {
        this.#hasConnected = true
        log.info('✓ Worker WebSocket connected to backend')
      })

      this.#ws.on('message', (raw: Buffer | string) => {
        try {
          const parsed = JSON.parse(raw.toString())
          if (parsed?.scope === 'clientConnected') {
            this.#clientConnected = true
            const waiters = this.#clientConnectedWaiters
            this.#clientConnectedWaiters = []
            for (const w of waiters) {
              try {
                w()
              } catch {
                /* ignore */
              }
            }
          } else if (parsed?.scope === 'clientDisconnected') {
            this.#onClientDisconnected?.()
          }
        } catch {
          // ignore non-JSON messages
        }
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

  setDriver(driver: SeleniumDriverLike) {
    this.#driver = driver
  }

  awaitClientConnected(): Promise<void> {
    if (this.#clientConnected) {
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.#clientConnectedWaiters.push(resolve)
    })
  }

  setClientDisconnectedHandler(fn: () => void) {
    this.#onClientDisconnected = fn
  }

  // ---- console & terminal capture ------------------------------------------

  #patchConsole() {
    // Non-standard consoles (Jest CustomConsole, Vitest) reroute writes past
    // our text filter and create a feedback loop — rely on stream interception.
    const protoName = Object.getPrototypeOf(console)?.constructor?.name
    if (protoName && protoName !== 'Console') {
      log.info(
        `Detected non-standard console (${protoName}) — skipping console patching, using stdout interception only`
      )
      return
    }
    CONSOLE_METHODS.forEach((method) => {
      const originalMethod = this.#originalConsoleMethods[method]
      console[method] = (...consoleArgs: any[]) => {
        this.#isCapturingConsole = true
        const result = originalMethod.apply(console, consoleArgs)
        this.#isCapturingConsole = false

        const rawText = consoleArgs
          .map((a) =>
            typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a)
          )
          .join(' ')
        const cleanText = stripAnsiCodes(rawText).trim()
        if (!cleanText) {
          return result
        }
        if (this.#isInternalStreamLine(cleanText)) {
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

  // Drop lines that would feed back into sendUpstream and loop: pino JSON,
  // [SESSION] markers, backend logs, Jest console.info framing.
  #isInternalStreamLine(line: string): boolean {
    const t = line.trim()
    if (t.startsWith('{"') || t.startsWith('[SESSION]')) {
      return true
    }
    if (t.includes('@wdio/devtools-backend')) {
      return true
    }
    if (/^console\.(log|info|warn|error|debug|trace)$/.test(t)) {
      return true
    }
    if (/^at\s.+:\d+:\d+\)?$/.test(t)) {
      return true
    }
    return false
  }

  #interceptProcessStreams() {
    const captureTerminalOutput = (outputData: string | Uint8Array) => {
      if (this.#isCapturingStream) {
        return
      }
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
          if (
            !clean ||
            this.#isInternalStreamLine(clean) ||
            SPINNER_RE.test(clean)
          ) {
            continue
          }
          linesToCapture.push(clean)
        }
        for (const clean of linesToCapture) {
          const entry = createConsoleLogEntry(
            detectLogLevel(clean),
            [clean],
            LOG_SOURCES.TERMINAL
          )
          this.consoleLogs.push(entry)
          this.sendUpstream('consoleLogs', [entry])
        }
      } finally {
        this.#isCapturingStream = false
      }
    }

    const interceptStreamWrite = (
      stream: NodeJS.WriteStream,
      original: (...args: any[]) => boolean
    ) => {
      const capturer = this
      stream.write = function (chunk: any, ...rest: any[]): boolean {
        const writeResult = original.call(stream, chunk, ...rest)
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

  // ---- WebSocket plumbing --------------------------------------------------

  get isReportingUpstream() {
    return Boolean(this.#ws) && this.#ws?.readyState === WebSocket.OPEN
  }

  isConnected(): boolean {
    return this.#ws?.readyState === WebSocket.OPEN
  }

  async waitForConnection(timeoutMs = 5000): Promise<boolean> {
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

  async closeWebSocket(): Promise<void> {
    if (!this.#ws || this.#ws.readyState === WebSocket.CLOSED) {
      return
    }
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 2000)
      this.#ws!.once('close', () => {
        clearTimeout(timeout)
        resolve()
      })
      this.#ws!.close()
    })
  }

  sendUpstream(event: string, data: any) {
    // Silent drops — logging here would loop back through stream interception.
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
      return
    }
    try {
      this.#ws.send(JSON.stringify({ scope: event, data }))
    } catch {
      /* teardown */
    }
  }

  // ---- command capture -----------------------------------------------------

  async captureCommand(
    command: string,
    args: any[],
    result: any,
    error: Error | undefined,
    testUid?: string,
    callSource?: string,
    timestamp?: number
  ): Promise<CommandLog & { _id?: number }> {
    const commandId = this.#commandCounter++
    // `id` is the stable lookup key — chained calls share a ms timestamp,
    // so timestamp-based matching rewrites the wrong entry on async updates.
    const entry: CommandLog & { _id?: number } = {
      _id: commandId,
      id: commandId,
      command,
      args,
      result,
      error: serializeError(error),
      timestamp: timestamp || Date.now(),
      callSource,
      testUid
    }
    this.commandsLog.push(entry)
    return entry
  }

  sendCommand(command: CommandLog & { _id?: number }) {
    if (command._id !== undefined && !this.#sentCommandIds.has(command._id)) {
      this.#sentCommandIds.add(command._id)
      const toSend = { ...command }
      delete toSend._id
      this.sendUpstream('commands', [toSend])
    }
  }

  sendReplaceCommand(
    oldTimestamp: number,
    command: CommandLog & { _id?: number }
  ) {
    const toSend = { ...command }
    delete toSend._id
    this.sendUpstream('replaceCommand', { oldTimestamp, command: toSend })
  }

  /** Update an existing entry in place (matched by `_id`) for retry coalesce. */
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
    const idx = this.commandsLog.findIndex(
      (c: any) => (c as CommandLog & { _id?: number })._id === oldId
    )
    const oldTimestamp =
      idx !== -1 ? ((this.commandsLog[idx] as any).timestamp ?? 0) : 0
    if (idx === -1) {
      const fresh = {
        _id: this.#commandCounter++,
        id: undefined as unknown as number,
        command,
        args,
        result,
        error: serializeError(error),
        timestamp: timestamp || Date.now(),
        callSource,
        testUid
      } as CommandLog & { _id?: number }
      ;(fresh as any).id = fresh._id
      this.commandsLog.push(fresh)
      return { entry: fresh, oldTimestamp: 0 }
    }
    const previous = this.commandsLog[idx] as CommandLog & {
      _id?: number
      id?: number
    }
    previous.command = command as any
    previous.args = args
    previous.result = result
    previous.error = serializeError(error) as any
    previous.timestamp = timestamp || Date.now()
    previous.callSource = callSource
    previous.testUid = testUid
    return { entry: previous, oldTimestamp }
  }

  // Uses the unwrapped original to avoid recursing through the command capturer.
  async takeScreenshot(): Promise<string | null> {
    const driver = this.#driver
    const originals = getDriverOriginals()
    const fn = originals.takeScreenshot
    if (!driver || !fn) {
      return null
    }
    try {
      const data = await fn(driver)
      return data || null
    } catch (err) {
      log.warn(`[screenshot] Failed: ${(err as Error).message}`)
      return null
    }
  }

  // ---- source files --------------------------------------------------------

  async captureSource(filePath: string) {
    if (this.sources.has(filePath)) {
      return
    }
    try {
      const source = await fs.readFile(filePath, 'utf-8')
      this.sources.set(filePath, source.toString())
      this.sendUpstream('sources', { [filePath]: source.toString() })
    } catch (err) {
      log.warn(
        `Failed to read source file ${filePath}: ${(err as Error).message}`
      )
    }
  }

  // ---- browser-side trace (script injection) -------------------------------

  async injectScript(): Promise<void> {
    const driver = this.#driver
    const exec = getDriverOriginals().executeScript
    if (!driver || !exec) {
      return
    }
    try {
      const scriptPath = require.resolve('@wdio/devtools-script')
      const scriptDir = path.dirname(scriptPath)
      const preloadScriptPath = path.join(scriptDir, 'script.js')
      let scriptContent = await fs.readFile(preloadScriptPath, 'utf-8')
      // Wrap top-level await so it can run inside a <script> body.
      scriptContent = `(async function() { ${scriptContent} })()`

      await exec(
        driver,
        "var s=document.createElement('script');s.textContent=arguments[0];document.head.appendChild(s);return true;",
        scriptContent
      )

      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 200))
        const ready = await exec(
          driver,
          'return typeof window.wdioTraceCollector !== "undefined";'
        )
        if (ready === true) {
          log.info('✓ Script injected and collector ready')
          return
        }
      }
      log.warn('Script injection may have failed — collector not found')
    } catch (err) {
      // Driver torn down between navigation and deferred trace work.
      const msg = (err as Error).message ?? ''
      if (
        msg.includes('ECONNREFUSED') ||
        msg.includes('no such session') ||
        msg.includes('invalid session id')
      ) {
        return
      }
      log.error(`Failed to inject script: ${msg}`)
    }
  }

  async captureTrace(): Promise<void> {
    const driver = this.#driver
    const exec = getDriverOriginals().executeScript
    if (!driver || !exec) {
      return
    }
    try {
      const ready = await exec(
        driver,
        'return typeof window.wdioTraceCollector !== "undefined";'
      )
      if (ready !== true) {
        return
      }
      const traceData = await exec(
        driver,
        'return window.wdioTraceCollector.getTraceData();'
      )
      if (!traceData) {
        return
      }
      const { mutations, traceLogs, consoleLogs, networkRequests, metadata } =
        traceData

      if (metadata) {
        this.metadata = { ...this.metadata, ...metadata }
        this.sendUpstream('metadata', this.metadata)
      }
      if (
        !this.bidiActive &&
        Array.isArray(consoleLogs) &&
        consoleLogs.length > 0
      ) {
        const tagged = consoleLogs.map((e: any) => ({
          ...e,
          source: LOG_SOURCES.BROWSER
        }))
        this.consoleLogs.push(...tagged)
        this.sendUpstream('consoleLogs', tagged)
      }
      if (
        !this.bidiActive &&
        Array.isArray(networkRequests) &&
        networkRequests.length > 0
      ) {
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
    } catch (err) {
      const msg = (err as Error).message ?? ''
      if (
        msg.includes('ECONNREFUSED') ||
        msg.includes('no such session') ||
        msg.includes('invalid session id')
      ) {
        return
      }
      log.error(`Failed to capture trace from injected script: ${msg}`)
    }
  }

  // ---- WebDriver browser/perf log capture ----------------------------------

  /** Pulls Chrome browser logs (requires `goog:loggingPrefs: { browser: 'ALL' }`). */
  async captureBrowserLogs(): Promise<void> {
    const driver = this.#driver
    const manage = getDriverOriginals().manage
    if (!driver || !manage) {
      return
    }
    try {
      const entries = await manage(driver).logs().get('browser')
      if (!Array.isArray(entries) || entries.length === 0) {
        return
      }
      const tagged: ConsoleLog[] = entries.map(
        (entry: { level: any; message: string; timestamp: number }) => ({
          timestamp: entry.timestamp,
          type: chromeLogLevelToLogLevel(entry.level),
          args: [entry.message],
          source: LOG_SOURCES.BROWSER
        })
      )
      this.consoleLogs.push(...tagged)
      this.sendUpstream('consoleLogs', tagged)
    } catch {
      // logging not enabled — silent
    }
  }

  isNavigationCommand(command: string): boolean {
    return NAVIGATION_COMMANDS.some((c) =>
      command.toLowerCase().includes(c.toLowerCase())
    )
  }
}
