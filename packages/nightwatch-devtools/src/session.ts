import logger from '@wdio/logger'
import {
  CAPTURE_PERFORMANCE_SCRIPT,
  COLLECTOR_READY_EXPRESSION,
  SessionCapturerBase,
  applyPerformanceData,
  collectorDrainExpression,
  drainCollectorWithRecovery,
  errorMessage,
  loadInjectableScript,
  mapChromeBrowserLogs,
  mapCommandToAction,
  pollUntilReady,
  serializeError,
  upsertRichestSnapshot,
  type CapturedPerformancePayload
} from '@wdio/devtools-core'
import { captureActionSnapshot } from './action-snapshot.js'
import { NAVIGATION_COMMANDS } from './constants.js'
import {
  parseNetworkFromPerfLogs,
  dedupeNetworkRequests,
  type NetworkEntry,
  type PerfLogEntry
} from './helpers/perfLogs.js'
import { webdriverExecute, webdriverGet } from './helpers/webdriverHttp.js'
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

export class SessionCapturer extends SessionCapturerBase {
  #browser: NightwatchBrowser | undefined

  // True once BiDi inspectors are attached — the per-command perf-log network
  // capture path skips when set, so we don't double-emit network requests.
  bidiActive = false

  /** True once the collector is registered to run at document-start. Every
   *  document then instruments and anchors itself, so the paths that exist to
   *  notice a navigation after the fact — re-injection and the settle poll — have
   *  nothing left to do and stand down. */
  preloadRegistered = false

  // Populated by captureCommand when mode === 'trace' (set by the plugin).
  traceMode: DevToolsMode = 'live'
  readonly actionSnapshots: ActionSnapshot[] = []
  readonly snapshotCaptures: Promise<void>[] = []

  constructor(
    devtoolsOptions: {
      hostname?: string
      port?: number
      reconnect?: boolean
    } = {},
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

    if (!error) {
      this.#queueActionSnapshot(command, commandLogEntry.timestamp)
    }

    return true
  }

  /** Fire-and-forget post-action snapshot, drained at finalize. Stamped with the
   *  logged command's timestamp, not the capture's own: the capture resolves
   *  after the command completes, and export claims snapshots by exact equality
   *  with the command timestamp (FrameSnapshotIndex.claimAfter / elementsAt). */
  #queueActionSnapshot(command: string, timestamp: number): void {
    if (
      this.traceMode !== 'trace' ||
      !this.#browser ||
      !mapCommandToAction(command)
    ) {
      return
    }
    this.snapshotCaptures.push(
      captureActionSnapshot(this.#browser, command, timestamp).then((snap) => {
        if (snap) {
          upsertRichestSnapshot(this.actionSnapshots, snap)
        }
      })
    )
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
   * Ingest a pre-built assertion entry (native `browser.assert`/`verify`
   * synthesized from Nightwatch's results, or a node:assert capture) into the
   * same command stream driver commands use. Unlike {@link captureCommand} this
   * preserves the entry's `title` (the human assertion message) and never
   * dedups — each call is a distinct action row. Assigns a fresh `_id` and a
   * matching stable public `id` (so a later `sendReplaceCommand` can update
   * this exact row in place — native asserts stream a pending row at call time,
   * then finalize their pass/fail), pushes, and broadcasts.
   */
  captureAssertCommand(entry: CommandLog): void {
    const withId = entry as CommandLog & { _id?: number }
    withId._id = this.commandCounter++
    withId.id = withId._id
    this.commandsLog.push(withId)
    // Deliberately no snapshot capture. These rows are emitted in a batch at
    // test-end but positioned back on their real execution window, so capturing
    // here would probe the page as it is NOW and stamp it at a moment seconds
    // earlier — an assert that ran on /secure rendered the /login page it later
    // logged out to. An assertion reads the page rather than changing it, so the
    // exporter lets it inherit the preceding action's capture instead
    // (FrameSnapshotIndex.claimAfter). The row's own `screenshot` is already
    // attached by the caller from the last resolved capture.
    this.sendCommand(withId)
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
   * Wait for a navigation to actually replace the document, then drain with a
   * forced anchor so the destination's DOM enters the stream.
   *
   * A Nightwatch click resolves BEFORE its navigation commits, so the drain that
   * runs at command completion still finds the outgoing page's collector: it
   * recovers nothing, and the destination is never anchored — every action on the
   * new page then replays the page it came from. Waiting for the collector to
   * disappear is the signal that the document was replaced; a command that
   * navigated nowhere polls out and costs one drain of an empty buffer.
   */
  async anchorAfterNavigation(browser: NightwatchBrowser): Promise<void> {
    const replaced = await pollUntilReady(
      async () =>
        (await webdriverExecute<boolean>(
          browser,
          `return ${COLLECTOR_READY_EXPRESSION};`
        )) !== true,
      // With the preload active every document instruments itself at
      // document-start, so there is normally nothing to catch — but ONE probe
      // still runs rather than standing down entirely, because a document created
      // before the registration landed has no collector and nothing else would
      // ever notice. Without the preload this is the only detector, so it keeps
      // the full settle poll.
      this.preloadRegistered
        ? { attempts: 1, intervalMs: 0 }
        : { attempts: 5, intervalMs: 150 }
    )
    if (!replaced) {
      return
    }
    // captureTrace's own recovery injects into the fresh document and re-drains,
    // and it gates that on the url being worth instrumenting — so a torn-down
    // session falls out here rather than logging an injection failure.
    //
    // The attribution is the newest command at THIS moment, not the one whose
    // completion started the poll: several polls overlap, so a field edit's poll
    // routinely observes the navigation the following click caused and would
    // credit itself — which pulled the anchor back before the edit's own row and
    // moved the wrong-DOM row one earlier instead of fixing it. Read at detection
    // time it is right for whichever poll gets there first.
    //
    // Unlike the inference in `anchorOwnerTimestamp`, this does not need the
    // "nothing completed after the anchor" guard: we just watched the document be
    // replaced, so a navigation demonstrably happened and the newest command is
    // the one that caused it. The guard exists for the case where that is a guess.
    await this.captureTrace(
      browser,
      true,
      this.commandsLog[this.commandsLog.length - 1]?.timestamp
    )
  }

  /**
   * Take a screenshot by calling the WebDriver HTTP endpoint directly, bypassing
   * Nightwatch's command queue so the request can't be appended after
   * `end()` / `quit()`.
   */
  takeScreenshotViaHttp(browser: NightwatchBrowser): Promise<string | null> {
    return webdriverGet<string>(browser, 'screenshot')
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
      // Injecting over a live collector replaces `window.wdioTraceCollector`
      // with a fresh instance and DISCARDS whatever it had buffered — including
      // the destination's full-DOM anchor. Several paths can reach the same
      // document (navigation proxy, drain recovery), so guard here once.
      const alreadyPresent = await webdriverExecute<boolean>(
        browser,
        `return ${COLLECTOR_READY_EXPRESSION};`
      )
      if (alreadyPresent === true) {
        return
      }
      const scriptContent = await loadInjectableScript()
      // Inlined as a literal rather than passed via `arguments[0]`: the raw
      // /execute/sync transport takes its args separately and this keeps the
      // injection a single self-contained body.
      const injectionScript = `
        const script = document.createElement('script');
        script.textContent = ${JSON.stringify(scriptContent)};
        document.head.appendChild(script);
        return true;
      `
      await webdriverExecute(browser, injectionScript)

      const hasCollector = await pollUntilReady(
        async () =>
          (await webdriverExecute<boolean>(
            browser,
            `return ${COLLECTOR_READY_EXPRESSION};`
          )) === true
      )

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
        // A perf-log entry that never saw its response event carries no type;
        // default it to the vocabulary's residual at this framework boundary.
        const normalized = deduped.map((d) => ({
          ...d,
          type: d.type ?? 'other'
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
  /** `forceAnchor` forces a full-DOM anchor of the current document before
   *  draining, so a freshly injected collector's async anchor isn't lost.
   *  `anchorTimestamp` is the command this drain's anchors were CAUSED by — pass
   *  it only when the caller observed the document being replaced right after
   *  that command, since it overrides the inference at ingest. */
  async captureTrace(
    browser: NightwatchBrowser,
    forceAnchor = false,
    anchorTimestamp?: number
  ) {
    // Capture network requests from Chrome performance logs
    await this.captureNetworkFromPerformanceLogs(browser)

    // Also try the injected wdioTraceCollector script for XHR/fetch and mutations.
    // Atomic check+read — the inline `typeof === 'undefined' → null` guard is
    // the only safe form; a separate existence check would race page navigation
    // (the collector can disappear between the two round-trips).
    try {
      const traceData = await drainCollectorWithRecovery({
        drain: () =>
          webdriverExecute<Record<string, unknown> | null>(
            browser,
            collectorDrainExpression(forceAnchor)
          ),
        injectIntoCurrentDocument: () => this.injectScript(browser),
        currentUrl: () =>
          webdriverExecute<string>(browser, 'return location.href;').then(
            (u) => u ?? undefined
          ),
        log: (level, message) => log[level](message)
      })

      if (!traceData) {
        return
      }

      this.processTracePayload(traceData, { anchorTimestamp })
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
