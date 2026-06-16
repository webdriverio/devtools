import http from 'node:http'
import logger from '@wdio/logger'
import {
  SessionCapturerBase,
  errorMessage,
  loadInjectableScript,
  mapChromeBrowserLogs,
  pollUntilReady,
  serializeError
} from '@wdio/devtools-core'
import { mapCommandToAction } from '@wdio/devtools-core'
import { captureActionSnapshot } from './action-snapshot.js'
import { NAVIGATION_COMMANDS } from './constants.js'
import {
  parseNetworkFromPerfLogs,
  dedupeNetworkRequests,
  type NetworkEntry,
  type PerfLogEntry
} from './helpers/perfLogs.js'
import {
  CAPTURE_PERFORMANCE_SCRIPT,
  type CapturedPerformancePayload,
  applyPerformanceData
} from '@wdio/devtools-core'
import type {
  ActionSnapshot,
  CommandLog,
  DevToolsMode,
  NightwatchBrowser
} from './types.js'

const log = logger('@wdio/nightwatch-devtools:SessionCapturer')

/**
 * WebDriver responses are sometimes wrapped as `{ value: T }` (the W3C
 * protocol shape) and sometimes flat. This helper unwraps the value field
 * if present, otherwise returns the input as-is.
 */
function unwrapDriverValue<T = unknown>(result: unknown): T {
  if (result && typeof result === 'object' && 'value' in result) {
    return (result as { value: T }).value
  }
  return result as T
}

type LooseRec = Record<string, unknown>
const getProp = (obj: unknown, key: string): unknown =>
  obj && typeof obj === 'object' ? (obj as LooseRec)[key] : undefined
const getPath = (obj: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((acc, k) => getProp(acc, k), obj)
const firstDefined = (obj: unknown, ...keys: string[]): unknown => {
  if (!obj || typeof obj !== 'object') {
    return undefined
  }
  const rec = obj as LooseRec
  for (const k of keys) {
    const v = rec[k]
    if (v !== undefined && v !== null) {
      return v
    }
  }
  return undefined
}

/**
 * Walks Nightwatch's internal config (transport / queue.transport /
 * nightwatchInstance — none of which are on the public NightwatchBrowser
 * type) to find the underlying WebDriver host+port for direct screenshot
 * fetches that bypass the command queue.
 */
function resolveWebDriverAddress(browser: NightwatchBrowser): {
  driverHost: string
  driverPort: number
} {
  const transportSettings =
    getPath(browser, 'transport', 'settings', 'webdriver') ||
    getPath(browser, 'queue', 'transport', 'settings', 'webdriver') ||
    getPath(
      browser,
      'nightwatchInstance',
      'transport',
      'settings',
      'webdriver'
    ) ||
    {}
  const opts = getProp(browser, 'options') ?? {}
  const nightwatchSettings =
    getPath(browser, 'nightwatchInstance', 'settings') ||
    getPath(browser, 'globals', 'nightwatchInstance', 'settings') ||
    {}
  const driverHost = String(
    firstDefined(transportSettings, 'host', 'server_address') ||
      firstDefined(getProp(opts, 'webdriver'), 'host') ||
      firstDefined(getProp(nightwatchSettings, 'webdriver'), 'host') ||
      'localhost'
  )
  const driverPort = Number(
    firstDefined(transportSettings, 'port') ||
      firstDefined(getProp(opts, 'webdriver'), 'port') ||
      firstDefined(getProp(nightwatchSettings, 'webdriver'), 'port') ||
      9515
  )
  return { driverHost, driverPort }
}

export class SessionCapturer extends SessionCapturerBase {
  #browser: NightwatchBrowser | undefined

  // True once BiDi inspectors are attached — the per-command perf-log network
  // capture path skips when set, so we don't double-emit network requests.
  bidiActive = false

  // Populated by captureCommand when mode === 'trace' (set by the plugin).
  traceMode: DevToolsMode = 'live'
  readonly actionSnapshots: ActionSnapshot[] = []
  readonly snapshotCaptures: Promise<void>[] = []

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
    log.error(`Couldn't connect to devtools backend: ${errorMessage(err)}`)
  }

  protected override onWsClose(): void {
    log.info('Worker WebSocket disconnected')
  }

  async captureCommand(
    command: string,
    args: unknown[],
    result: unknown,
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
        log.warn(`Failed to capture performance data: ${errorMessage(err)}`)
      })
    }

    if (
      this.traceMode === 'trace' &&
      !error &&
      this.#browser &&
      mapCommandToAction(command)
    ) {
      const browser = this.#browser
      this.snapshotCaptures.push(
        captureActionSnapshot(browser, command, () =>
          this.takeScreenshotViaHttp(browser)
        ).then((snap) => {
          if (snap) {
            this.actionSnapshots.push(snap)
          }
        })
      )
    }

    return true
  }

  async #capturePerformanceData(
    commandLogEntry: CommandLog & { _id?: number },
    args: unknown[]
  ) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    const raw = await this.#browser!.execute(CAPTURE_PERFORMANCE_SCRIPT)
    const payload = unwrapDriverValue<CapturedPerformancePayload | undefined>(
      raw
    )
    applyPerformanceData(
      commandLogEntry,
      payload,
      typeof args[0] === 'string' ? args[0] : undefined
    )
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
    args: unknown[],
    result: unknown,
    error: Error | undefined,
    testUid?: string,
    callSource?: string,
    timestamp?: number
  ): { entry: CommandLog & { _id?: number }; oldTimestamp: number } {
    // Remove the superseded entry and capture its timestamp for the UI
    const idx = this.commandsLog.findIndex(
      (c) => (c as CommandLog & { _id?: number })._id === oldId
    )
    const oldTimestamp: number =
      idx !== -1 ? (this.commandsLog[idx]?.timestamp ?? 0) : 0
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
  // Nightwatch's internal config lives at non-public paths (transport,
  // queue.transport, nightwatchInstance.settings, globals.nightwatchInstance);
  // none are in the NightwatchBrowser type. Cast for dynamic access.
  #resolveDriverEndpoint(
    browser: NightwatchBrowser,
    sessionId: string
  ): string {
    const { driverHost, driverPort } = resolveWebDriverAddress(browser)
    return `http://${driverHost}:${driverPort}/session/${sessionId}/screenshot`
  }

  takeScreenshotViaHttp(browser: NightwatchBrowser): Promise<string | null> {
    const sessionId = (browser as unknown as { sessionId?: string }).sessionId
    if (!sessionId) {
      return Promise.resolve(null)
    }
    const endpoint = this.#resolveDriverEndpoint(browser, sessionId)
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
          `[screenshot] HTTP request failed (${endpoint}): ${errorMessage(err)}`
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

  protected override onSourceReadError(filePath: string, err: unknown): void {
    log.warn(`Failed to read source file ${filePath}: ${errorMessage(err)}`)
  }

  protected override onUpstreamDrop(
    event: string,
    reason: 'closed' | 'send-error',
    err?: unknown
  ): void {
    if (reason === 'send-error') {
      log.warn(`[upstream] Failed to send "${event}": ${errorMessage(err)}`)
      return
    }
    if (this.hasEverConnected()) {
      log.warn(`[upstream] WebSocket not open — dropping "${event}" event`)
    }
  }

  /**
   * Inject the WDIO devtools script into the browser page
   */
  async injectScript(browser: NightwatchBrowser) {
    try {
      const scriptContent = await loadInjectableScript()
      const injectionScript = `
        const script = document.createElement('script');
        script.textContent = arguments[0];
        document.head.appendChild(script);
        return true;
      `
      await browser.execute(injectionScript, [scriptContent])

      const hasCollector = await pollUntilReady(async () => {
        const checkResult = await browser.execute(
          'return typeof window.wdioTraceCollector !== "undefined"'
        )
        return unwrapDriverValue<unknown>(checkResult) === true
      })

      if (hasCollector) {
        log.info('✓ Script injected and collector ready')
      } else {
        log.warn('Script injection may have failed — collector not found')
      }
    } catch (err) {
      log.error(`Failed to inject script: ${errorMessage(err)}`)
      throw err
    }
  }

  /**
   * Capture Chrome DevTools browser console logs via WebDriver log API.
   * Requires loggingPrefs: { browser: 'ALL' } in Chrome capabilities.
   */
  async captureBrowserLogs(browser: NightwatchBrowser) {
    try {
      const rawLogs = await (
        browser as unknown as Record<string, (type: string) => Promise<unknown>>
      ).getLog('browser')
      const logs =
        unwrapDriverValue<
          Array<{ level: string; message: string; timestamp: number }>
        >(rawLogs)

      if (!Array.isArray(logs) || logs.length === 0) {
        return
      }

      const entries = mapChromeBrowserLogs(logs)
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
    // BiDi network inspector is the source of truth when attached.
    if (this.bidiActive) {
      return
    }
    try {
      const rawLogs = await (
        browser as unknown as Record<string, (type: string) => Promise<unknown>>
      ).getLog('performance')
      const logs = unwrapDriverValue<PerfLogEntry[]>(rawLogs)

      if (!Array.isArray(logs) || logs.length === 0) {
        return
      }

      const networkEntries = parseNetworkFromPerfLogs(logs)
      if (networkEntries.length === 0) {
        return
      }

      const deduped = dedupeNetworkRequests(
        networkEntries,
        this.networkRequests as NetworkEntry[]
      )
      if (deduped.length > 0) {
        // NetworkEntry has `type?: string`; the shared NetworkRequest needs
        // `type: string` so default the field at this framework boundary.
        const normalized = deduped.map((d) => ({
          ...d,
          type: d.type ?? 'unknown'
        }))
        this.networkRequests.push(...normalized)
        this.sendUpstream('networkRequests', normalized)
      }
    } catch (err) {
      const msg = errorMessage(err) ?? ''
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

    // Also try the injected wdioTraceCollector script for XHR/fetch and mutations.
    // Atomic check+read — the inline `typeof === 'undefined' → null` guard is
    // the only safe form; a separate existence check would race page navigation
    // (the collector can disappear between the two round-trips).
    try {
      const result = await browser.execute(`
        if (typeof window.wdioTraceCollector === 'undefined') {
          return null;
        }
        return window.wdioTraceCollector.getTraceData();
      `)

      const traceData = unwrapDriverValue<Record<string, unknown> | null>(
        result
      )
      if (!traceData) {
        return
      }

      this.processTracePayload(traceData)
      const mutationCount = Array.isArray(
        (traceData as { mutations?: unknown }).mutations
      )
        ? (traceData as { mutations: unknown[] }).mutations.length
        : 0
      if (mutationCount > 0) {
        log.info(`[trace] Captured ${mutationCount} DOM mutation(s)`)
      }
    } catch (err) {
      log.error(
        `Failed to capture trace from injected script: ${errorMessage(err)}`
      )
    }
  }
}
