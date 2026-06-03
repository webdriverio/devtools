import logger from '@wdio/logger'
import {
  SessionCapturerBase,
  createConsoleLogEntry,
  errorMessage,
  loadInjectableScript,
  mapChromeBrowserLogs,
  pollUntilReady,
  serializeError,
  type LogSource
} from '@wdio/devtools-core'
import { WS_SCOPE } from '@wdio/devtools-shared'
import { NAVIGATION_COMMANDS } from './constants.js'
import { getDriverOriginals } from './driverPatcher.js'
import type { CommandLog, LogLevel, SeleniumDriverLike } from './types.js'

const log = logger('@wdio/selenium-devtools:SessionCapturer')

export class SessionCapturer extends SessionCapturerBase {
  #driver: SeleniumDriverLike | undefined

  // True once BiDi inspectors are attached — script-trace path skips streams.
  bidiActive = false
  #clientConnected = false
  #clientConnectedWaiters: Array<() => void> = []
  #onClientDisconnected?: () => void

  constructor(
    devtoolsOptions: { hostname?: string; port?: number } = {},
    driver?: SeleniumDriverLike
  ) {
    super(devtoolsOptions)
    this.#driver = driver

    // Skip console patching when running under Jest's CustomConsole / Vitest —
    // those reroute writes through their own console, which causes our patched
    // `console.*` to feed back through stream interception and loop. Stream
    // interception alone is sufficient in that case.
    const protoName = Object.getPrototypeOf(console)?.constructor?.name
    if (!protoName || protoName === 'Console') {
      this.patchConsole()
    } else {
      log.info(
        `Detected non-standard console (${protoName}) — skipping console patching, using stdout interception only`
      )
    }
    this.patchStreams()
  }

  protected override onWsOpen(): void {
    log.info('✓ Worker WebSocket connected to backend')
  }

  protected override onWsError(err: unknown): void {
    log.error(`Couldn't connect to devtools backend: ${errorMessage(err)}`)
  }

  protected override onWsClose(): void {
    log.info('Worker WebSocket disconnected')
  }

  protected override onWsMessage(msg: unknown): void {
    const parsed = msg as { scope?: string } | null | undefined
    if (parsed?.scope === WS_SCOPE.clientConnected) {
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
    } else if (parsed?.scope === WS_SCOPE.clientDisconnected) {
      this.#onClientDisconnected?.()
    }
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

  // ---- WebSocket plumbing --------------------------------------------------

  // ---- command capture -----------------------------------------------------

  async captureCommand(
    command: string,
    args: unknown[],
    result: unknown,
    error: Error | undefined,
    testUid?: string,
    callSource?: string,
    timestamp?: number
  ): Promise<CommandLog & { _id?: number }> {
    const commandId = this.commandCounter++
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

  /** Update an existing entry in place (matched by `_id`) for retry coalesce. */
  replaceCommand(
    oldId: number,
    command: string,
    args: unknown[],
    result: unknown,
    error: Error | undefined,
    testUid?: string,
    callSource?: string,
    timestamp?: number
  ): { entry: CommandLog & { _id?: number }; oldTimestamp: number } {
    const idx = this.commandsLog.findIndex(
      (c) => (c as CommandLog & { _id?: number })._id === oldId
    )
    const oldTimestamp =
      idx !== -1 ? (this.commandsLog[idx]?.timestamp ?? 0) : 0
    if (idx === -1) {
      const newId = this.commandCounter++
      const fresh: CommandLog & { _id?: number; id?: number } = {
        _id: newId,
        id: newId,
        command,
        args,
        result,
        error: serializeError(error),
        timestamp: timestamp || Date.now(),
        callSource,
        testUid
      }
      this.commandsLog.push(fresh)
      return { entry: fresh, oldTimestamp: 0 }
    }
    const previous = this.commandsLog[idx] as CommandLog & {
      _id?: number
      id?: number
    }
    previous.command = command
    previous.args = args
    previous.result = result
    previous.error = serializeError(error)
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
      log.warn(`[screenshot] Failed: ${errorMessage(err)}`)
      return null
    }
  }

  // ---- source files --------------------------------------------------------

  protected override onSourceReadError(filePath: string, err: unknown): void {
    log.warn(`Failed to read source file ${filePath}: ${errorMessage(err)}`)
  }

  // ---- browser-side trace (script injection) -------------------------------

  async injectScript(): Promise<void> {
    const driver = this.#driver
    const exec = getDriverOriginals().executeScript
    if (!driver || !exec) {
      return
    }
    try {
      const scriptContent = await loadInjectableScript()
      await exec(
        driver,
        "var s=document.createElement('script');s.textContent=arguments[0];document.head.appendChild(s);return true;",
        scriptContent
      )
      const ready = await pollUntilReady(async () => {
        const r = await exec(
          driver,
          'return typeof window.wdioTraceCollector !== "undefined";'
        )
        return r === true
      })
      if (ready) {
        log.info('✓ Script injected and collector ready')
      } else {
        log.warn('Script injection may have failed — collector not found')
      }
    } catch (err) {
      // Driver torn down between navigation and deferred trace work.
      const msg = errorMessage(err)
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
      this.processTracePayload(traceData as Record<string, unknown>, {
        skipConsoleLogs: this.bidiActive,
        skipNetworkRequests: this.bidiActive
      })
    } catch (err) {
      const msg = errorMessage(err)
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
      // selenium-webdriver's Options.logs() chain is untyped at our boundary;
      // narrow the result locally rather than typing the whole chain.
      type RawBrowserLog = {
        level: unknown
        message: string
        timestamp: number
      }
      const logs = (
        manage(driver) as {
          logs: () => { get: (t: string) => Promise<RawBrowserLog[]> }
        }
      ).logs()
      const entries = await logs.get('browser')
      if (!Array.isArray(entries) || entries.length === 0) {
        return
      }
      const tagged = mapChromeBrowserLogs(entries)
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
