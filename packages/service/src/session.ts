import fs from 'node:fs/promises'
import url from 'node:url'

import logger from '@wdio/logger'
import { parse } from 'stack-trace'
import { resolve } from 'import-meta-resolve'
import { SevereServiceError } from 'webdriverio'
import type { WebDriverCommands } from '@wdio/protocols'

import { PAGE_TRANSITION_COMMANDS } from './constants.js'
import { isNativeMobile } from './mobile.js'
import {
  CAPTURE_PERFORMANCE_SCRIPT,
  LOG_SOURCES,
  RetryTracker,
  SessionCapturerBase,
  applyPerformanceData,
  errorMessage,
  getRequestType,
  type CapturedPerformancePayload
} from '@wdio/devtools-core'
import type { CommandLog } from './types.js'

const log = logger('@wdio/devtools-service:SessionCapturer')

export class SessionCapturer extends SessionCapturerBase {
  #isScriptInjected = false
  /** Session start wall time for trace event timestamps. */
  readonly startWallTime = Date.now()
  /** Last find-element selector — carried forward to the next element command. */
  #lastSelector: string | undefined
  /** Collapses internal command retries onto a single entry (see #captureOrReplace). */
  #retryTracker = new RetryTracker()
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

  /**
   * Reset the last-captured selector so element-scoped commands in the next
   * test don't inherit a stale selector from a previous test.
   */
  resetLastSelector(): void {
    this.#lastSelector = undefined
  }

  protected override onWsError(err: unknown): void {
    log.error(`Couldn't connect to devtools backend: ${errorMessage(err)}`)
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
    callSource?: string,
    commandStartTime?: number,
    testUid?: string,
    stepUid?: string
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
      startTime: commandStartTime,
      callSource: callSource ?? absolutePath,
      testUid,
      stepUid
    }
    if (!isNativeMobile(browser)) {
      try {
        commandLogEntry.screenshot = await browser.takeScreenshot()
      } catch (screenshotError) {
        log.warn(
          `failed to capture screenshot: ${(screenshotError as Error).message}`
        )
      }
    }
    const cmd = String(command)

    // Track last find-element selector so element commands (click, setValue, …)
    // carry a human-readable selector in trace events even though WDIO doesn't
    // pass it in their args.
    if (
      cmd === '$' ||
      cmd === '$$' ||
      cmd === 'findElement' ||
      cmd === 'findElements'
    ) {
      const sel = args[0]
      if (typeof sel === 'string' && sel.length > 0) {
        this.#lastSelector = sel
      }
    }

    // For element-scoped commands without meaningful args, inject the last
    // selector so the trace event shows what element was acted upon.
    if (
      this.#lastSelector &&
      (cmd === 'click' ||
        cmd === 'doubleClick' ||
        cmd === 'moveTo' ||
        cmd === 'scrollIntoView' ||
        cmd === 'touchAction' ||
        cmd === 'dragAndDrop' ||
        cmd === 'getText' ||
        cmd === 'getAttribute' ||
        cmd === 'clearValue' ||
        cmd === 'waitForExist' ||
        cmd === 'waitForDisplayed' ||
        cmd === 'waitForEnabled' ||
        cmd === 'waitForClickable')
    ) {
      const hasNoSelector =
        args.length === 0 ||
        (args.length === 1 &&
          typeof args[0] === 'object' &&
          args[0] !== null &&
          !Array.isArray(args[0]) &&
          Object.keys(args[0] as object).some((k) => k.startsWith('element-')))
      if (hasNoSelector) {
        commandLogEntry.args = [this.#lastSelector]
      }
    }

    // For setValue / addValue, prepend the last selector so trace params
    // carry both {selector, value} like the MCP set_value tool does.
    if (this.#lastSelector && (cmd === 'setValue' || cmd === 'addValue')) {
      const hasNoSelector = args.length >= 1 && typeof args[0] !== 'object'
      if (hasNoSelector) {
        commandLogEntry.args = [this.#lastSelector, ...args]
      }
    }

    this.#captureOrReplace(commandLogEntry)
    // Capture trace + perf on commands that could trigger a page transition.
    // Skip on native mobile — scripts can't execute in a native app context.
    if (
      !isNativeMobile(browser) &&
      PAGE_TRANSITION_COMMANDS.includes(command)
    ) {
      await Promise.all([
        this.#capturePerformance(browser, commandLogEntry, args),
        this.captureTrace(browser)
      ])
    }
  }

  /**
   * Send a command, collapsing internal framework retries onto one entry. WDIO
   * polls some commands (e.g. an assertion repeatedly calling `getText`); each
   * poll fires `afterCommand`, so without this the UI fills with duplicate
   * rows. A matching signature (same command + args + call site) replaces the
   * previous entry in place — mirroring the nightwatch and selenium adapters.
   */
  #captureOrReplace(entry: CommandLog & { _id?: number }) {
    const sig = RetryTracker.signature(
      entry.command,
      entry.args,
      entry.callSource
    )
    if (this.#retryTracker.isRetry(sig)) {
      const prev = this.commandsLog.find(
        (c) =>
          (c as CommandLog & { _id?: number })._id === this.#retryTracker.lastId
      ) as (CommandLog & { _id?: number }) | undefined
      const oldTimestamp = prev?.timestamp ?? entry.timestamp
      if (prev) {
        entry._id = prev._id
        Object.assign(prev, entry)
      } else {
        this.commandsLog.push(entry)
      }
      this.sendReplaceCommand(oldTimestamp, entry)
      this.#retryTracker.recordCapture(sig, entry._id ?? null)
      return
    }
    this.commandsLog.push(entry)
    const id = this.sendCommand(entry)
    this.#retryTracker.recordCapture(sig, id)
  }

  /** Drop retry state at test/scenario boundaries so a deliberate re-issue of
   *  the same call in the next test counts as fresh, not a retry. */
  resetRetryTracker(): void {
    this.#retryTracker.reset()
  }

  /** Ingest an assertion entry (node:assert capture or synthesized expect
   *  failure) through the same retry-collapsing path driver commands use. */
  captureAssertCommand(entry: CommandLog): void {
    this.#captureOrReplace(entry)
  }

  /**
   * Fold an expect-matcher assertion into the matcher's value-read command when
   * that read is the most recent captured command (per `isRead`). The read
   * already carries the correct callSource, screenshot, and timeline position —
   * the DOM the matcher evaluated — so replace it in place with the assertion
   * row: one row, no duplicate, and no timing/stack heuristics. WDIO's
   * RetryTracker already collapses a matcher's repeated polls to that one read.
   * Returns false when the last command isn't a matcher read (a value matcher),
   * so the caller emits a fresh assertion row instead.
   *
   * `foldErrored` folds even when the read carries an error — used by the
   * hard-throw path (element never resolved, so afterAssertion never fired and
   * the read threw): relabel the throwing read as the failing expect row rather
   * than leave a raw `getText`. The normal path keeps the guard so a value
   * matcher can't accidentally swallow an unrelated errored command.
   */
  coalesceAssertionIntoLastRead(
    entry: CommandLog,
    isRead: (command: string) => boolean,
    foldErrored = false
  ): boolean {
    const log = this.commandsLog as (CommandLog & { _id?: number })[]
    const last = log[log.length - 1]
    if (!last || !isRead(last.command) || (last.error && !foldErrored)) {
      return false
    }
    // Inherit the read's `_id` (local dedup bookkeeping) and timestamp, but do
    // NOT stamp a public `id`: WDIO replaces by timestamp (like #captureOrReplace),
    // and `commandCounter` resets per worker/spec, so a bare `id` collides across
    // specs and the app's id-first replaceCommand would swap the wrong row.
    const merged: CommandLog & { _id?: number } = {
      ...entry,
      _id: last._id,
      timestamp: last.timestamp,
      startTime: last.startTime,
      callSource: entry.callSource ?? last.callSource,
      screenshot: entry.screenshot ?? last.screenshot,
      error: entry.error ?? last.error
    }
    log[log.length - 1] = merged
    this.sendReplaceCommand(last.timestamp, merged)
    return true
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

  /** Clear the per-session injection guard so the next `injectScript` re-adds
   *  the preload script. BiDi preload scripts are scoped to one session, so
   *  after `reloadSession()` the new session has none — without this, DOM
   *  capture silently stops after the first session. The guard itself still
   *  prevents double-adding within a single session. */
  resetScriptInjection() {
    this.#isScriptInjected = false
  }

  /** Drain the current page's buffered trace data (mutations/console/network)
   *  into the capturer. Public so the plugin can flush BEFORE a navigating
   *  command, capturing the outgoing page's field edits (value/checked
   *  mutations fire no page transition) before its collector is discarded. */
  async captureTrace(browser: WebdriverIO.Browser) {
    if (!this.#isScriptInjected) {
      log.warn('Script not injected, skipping trace capture')
      return
    }

    try {
      // Atomic check+read in a single browser.execute so the collector can't
      // disappear (page navigation) between the existence check and the
      // getTraceData call. Two round-trips left a TOCTOU race that surfaced
      // spurious "Cannot read properties of undefined" errors.
      const payload = await browser.execute(() =>
        typeof window.wdioTraceCollector !== 'undefined'
          ? window.wdioTraceCollector.getTraceData()
          : null
      )
      if (!payload) {
        log.warn(
          'wdioTraceCollector not loaded yet - page loaded before preload script took effect'
        )
        return
      }
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
      const requestHeaders = this.#flattenBidiHeaders(request.headers)

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

  handleNetworkFetchError(event: {
    request: { request: string }
    errorText?: string
  }) {
    const requestId = event.request.request
    const pending = this.#pendingNetworkRequests.get(requestId)
    if (pending) {
      // Emit a HAR resource-snapshot with status 0 and failure text so the
      // trace viewer shows the failed request rather than silently dropping it.
      this.#pendingNetworkRequests.delete(requestId)
      const endTime = performance.now()
      const networkRequest: NetworkRequest = {
        id: `${Date.now()}-${requestId}`,
        url: pending.url,
        method: pending.method,
        status: 0,
        statusText: event.errorText ?? 'Failed',
        type: 'other',
        timestamp: pending.timestamp,
        startTime: pending.startTime,
        endTime,
        time: endTime - pending.startTime,
        requestHeaders: pending.requestHeaders
      }
      this.networkRequests.push(networkRequest)
      this.sendUpstream('networkRequests', [networkRequest])
    }
  }
}
