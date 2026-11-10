import logger from '@wdio/logger'
import {
  CAPTURE_PERFORMANCE_SCRIPT,
  SessionCapturerBase,
  applyPerformanceData,
  collectorDrainExpression,
  drainCollectorWithRecovery,
  errorMessage,
  loadInjectableScript,
  NativeNetworkCapture,
  pollUntilReady,
  serializeError,
  type CapturedPerformancePayload,
  type SessionCapturerOptions
} from '@wdio/devtools-core'
import {
  COLLECTOR_INJECT_SCRIPT,
  COLLECTOR_READY_SCRIPT,
  skipsCapture
} from '@wdio/devtools-shared'
import { captureActionSnapshot } from './action-snapshot.js'
import {
  recaptureAfterNavigation,
  type QueuedPageCapture
} from './navigation-recapture.js'
import { nightwatchRunnerId } from './helpers/utils.js'
import { NAVIGATION_COMMANDS } from './constants.js'
import {
  parseNetworkFromPerfLogs,
  dedupeNetworkRequests,
  upgradeResourceTimingRows,
  withoutLoadsTheLogListed,
  type LoadListedByLog,
  type NetworkEntry,
  type PerfLogEntry
} from './helpers/perfLogs.js'
import {
  webdriverExecute,
  webdriverGet,
  webdriverPost
} from './helpers/webdriverHttp.js'
import type {
  ActionSnapshot,
  CommandCaptureMeta,
  CommandLog,
  DevToolsMode,
  NightwatchBrowser,
  TestRunnerId
} from './types.js'

const log = logger('@wdio/nightwatch-devtools:SessionCapturer')

export class SessionCapturer extends SessionCapturerBase {
  #browser: NightwatchBrowser | undefined
  /** The most recent page-changing capture; read synchronously when a navigation is detected for its command. */
  #lastPageCapture: QueuedPageCapture | undefined
  /** Capture timestamps already re-captured or re-capturing; overlapping polls see the same replacement. */
  #lastRecapturedAt?: number

  // True once BiDi inspectors are attached — the per-command perf-log network
  // capture path skips when set, so we don't double-emit network requests.
  bidiActive = false
  /** Whether BiDi has delivered at least one network event; a subscription
   *  that delivers nothing is not a source. */
  bidiNetworkObserved = false

  /** Whether the session was created with `goog:loggingPrefs.performance`, set
   *  from the capabilities at session init. A perf log exists only because a
   *  session asked for one, so without it every fetch is a round trip that can
   *  only fail — and the driver's own transport prints each failure, so the
   *  cost is a wall of errors on a run that passed: measured on iOS Safari,
   *  21 of them in a two-test run, where XCUITest lists `performance` among its
   *  supported types and then serves none of it. */
  perfLogsRequested = false

  /** Loads the performance log listed before the page's drain could, spent
   *  at the next drain that reaches the driver, whatever it finds, and
   *  emptied with the session that listed them. */
  loadsListedByLog: LoadListedByLog[] = []

  /** True once the collector is registered to run at document-start. Every
   *  document then instruments and anchors itself, so the paths that exist to
   *  notice a navigation after the fact — re-injection and the settle poll — have
   *  nothing left to do and stand down. */
  preloadRegistered = false

  // Populated by captureCommand when mode === 'trace' (set by the plugin).
  traceMode: DevToolsMode = 'live'

  /** Which Nightwatch runner is driving — set by the plugin, and passed to the
   *  per-action capture so the injected scripts emit this runner's dialect. */
  runner: TestRunnerId = nightwatchRunnerId(false)
  readonly actionSnapshots: ActionSnapshot[] = []
  readonly snapshotCaptures: Promise<void>[] = []
  /** Native app network from appium-interceptor's proxy; started per session. */
  readonly nativeNetwork = new NativeNetworkCapture(this, (level, message) =>
    log[level](message)
  )

  constructor(
    devtoolsOptions: SessionCapturerOptions = {},
    browser?: NightwatchBrowser
  ) {
    super(devtoolsOptions)
    this.#browser = browser
    this.patchConsole()
    this.patchStreams()
  }

  /** Re-target at the browser the run now drives — the capturer's only
   *  session-bound state, so a replaced session is a re-target, not a rebuild
   *  (mirrors selenium's `setDriver`). */
  setBrowser(browser: NightwatchBrowser): void {
    this.#browser = browser
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
    meta: CommandCaptureMeta = {}
  ): Promise<boolean> {
    // A public `id`, so a late replace of this row cannot land on another row stamped in the same millisecond.
    const commandLogEntry = this.#commandEntry(
      command,
      args,
      result,
      error,
      meta
    )

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
      this.#queueActionSnapshot(
        command,
        args,
        commandLogEntry.timestamp,
        meta.parentId
      )
    }

    return true
  }

  /** Fire-and-forget post-action snapshot, drained at finalize. Stamped with the
   *  logged command's timestamp, not the capture's own: the capture resolves
   *  after the command completes, and export claims snapshots by exact equality
   *  with the command timestamp (FrameSnapshotIndex.claimAfter / elementsAt). */
  #queueActionSnapshot(
    command: string,
    args: unknown[],
    timestamp: number,
    parentId: number | undefined
  ): void {
    if (this.traceMode !== 'trace' || !this.#browser) {
      return
    }
    // `url()` without a string argument is a getter; it does not navigate.
    const pageChanging =
      !skipsCapture(command) &&
      !(command === 'url' && typeof args[0] !== 'string')
    const browser = this.#browser
    const settled = this.testCapture.queue(
      command,
      timestamp,
      pageChanging,
      this.actionSnapshots,
      this.snapshotCaptures,
      () =>
        captureActionSnapshot(
          browser,
          command,
          timestamp,
          this.runner,
          this.nativeApp,
          parentId === undefined ? 'action' : 'wait-poll'
        )
    )
    if (settled && pageChanging) {
      this.#lastPageCapture = { command, timestamp, settled }
    }
  }

  async #capturePerformanceData(
    commandLogEntry: CommandLog & { _id?: number },
    args: unknown[]
  ) {
    // Page script, and the 500 ms settle below would be spent to reach a
    // document that does not exist.
    if (this.isNativeAppSession) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
    // A queued `browser.execute` fired from this timer becomes a child of whatever command is running, and resolves that command's await early.
    const payload = await webdriverExecute<CapturedPerformancePayload>(
      this.#browser!,
      CAPTURE_PERFORMANCE_SCRIPT
    )
    if (
      applyPerformanceData(
        commandLogEntry,
        payload ?? undefined,
        typeof args[0] === 'string' ? args[0] : undefined
      ) &&
      // A retry may have replaced the row meanwhile; replacing it again would bring the old row back.
      this.commandsLog.includes(commandLogEntry)
    ) {
      // The row was sent when the command completed; the timings arrive half a second later.
      this.sendReplaceCommand(commandLogEntry.timestamp, commandLogEntry)
    }
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
    meta: CommandCaptureMeta = {}
  ): { entry: CommandLog & { _id?: number }; oldTimestamp: number } {
    // Remove the superseded entry and capture its timestamp for the UI
    const idx = this.commandsLog.findIndex(
      (c) => (c as CommandLog & { _id?: number })._id === oldId
    )
    const previous = idx !== -1 ? this.commandsLog[idx] : undefined
    const oldTimestamp: number = previous?.timestamp ?? 0
    if (idx !== -1) {
      this.commandsLog.splice(idx, 1)
    }
    // Allow the slot to be re-used by a new entry
    this.sentCommandIds.delete(oldId)

    // The retry keeps the row's public `id`, so the dashboard updates the row it already shows.
    const entry = this.#commandEntry(
      command,
      args,
      result,
      error,
      meta,
      previous?.id
    )
    this.commandsLog.push(entry)
    return { entry, oldTimestamp }
  }

  #commandEntry(
    command: string,
    args: unknown[],
    result: unknown,
    error: Error | undefined,
    meta: CommandCaptureMeta,
    publicId?: number
  ): CommandLog & { _id?: number } {
    const commandId = this.commandCounter++
    return {
      _id: commandId,
      id: publicId ?? commandId,
      command,
      args,
      result,
      // Error objects don't JSON.stringify well.
      error: serializeError(error),
      timestamp: meta.timestamp || Date.now(),
      startTime: meta.startTime,
      sequence: meta.sequence,
      callSource: meta.callSource,
      testUid: meta.testUid,
      selector: meta.selector,
      parentId: meta.parentId
    }
  }

  /** Rows {@link openCommand} sent that have not ended yet. */
  readonly #openRows = new Set<CommandLog>()

  /** The newest row that has ended: a row still running has caused nothing yet. */
  #newestEndedTimestamp(): number | undefined {
    for (let i = this.commandsLog.length - 1; i >= 0; i--) {
      if (!this.#openRows.has(this.commandsLog[i])) {
        return this.commandsLog[i].timestamp
      }
    }
    return undefined
  }

  /** Send a row that has started and not ended (a wait), so the rows it issues have a row to nest under while it runs. */
  openCommand(
    command: string,
    args: unknown[],
    meta: CommandCaptureMeta
  ): CommandLog & { _id?: number } {
    const id = this.commandCounter++
    const entry: CommandLog & { _id?: number } = {
      _id: id,
      id,
      command,
      args,
      timestamp: meta.startTime ?? Date.now(),
      startTime: meta.startTime,
      sequence: meta.sequence,
      callSource: meta.callSource,
      testUid: meta.testUid,
      selector: meta.selector,
      parentId: meta.parentId
    }
    this.commandsLog.push(entry)
    this.#openRows.add(entry)
    this.sendCommand(entry)
    return entry
  }

  /** End a row {@link openCommand} sent, stamped at completion, replaced by its `id` and moved to where it completed; a row that never ran keeps its place. */
  closeCommand(
    entry: CommandLog & { _id?: number },
    result: unknown,
    error: Error | undefined,
    timestamp: number,
    ran = true
  ): void {
    this.#openRows.delete(entry)
    // From the end: the wait and what it issued are the newest rows.
    const at = this.commandsLog.lastIndexOf(entry)
    if (ran && at !== -1) {
      this.commandsLog.splice(at, 1)
      this.commandsLog.push(entry)
    }
    const oldTimestamp = entry.timestamp
    entry.result = result
    entry.error = serializeError(error)
    entry.timestamp = timestamp
    if (!error) {
      this.#queueActionSnapshot(
        entry.command,
        entry.args,
        timestamp,
        entry.parentId
      )
    }
    this.sendReplaceCommand(oldTimestamp, entry)
  }

  /** Birth time of the document this capturer last observed, so a replacement
   *  is still visible to a poll that starts after the navigation committed. */
  private lastDocumentOrigin: number | undefined

  /** The current document's own birth time, which is what a DOM anchor is
   *  stamped with. Undefined when the session cannot answer. */
  private async documentOrigin(
    browser: NightwatchBrowser
  ): Promise<number | undefined> {
    return webdriverExecute<number>(browser, 'return performance.timeOrigin;')
      .then((origin) => origin ?? undefined)
      .catch(() => undefined)
  }

  /**
   * Wait for a navigation to actually replace the document, then drain with a
   * forced anchor so the destination's DOM enters the stream.
   *
   * A Nightwatch click resolves BEFORE its navigation commits, so the drain that
   * runs at command completion still finds the outgoing page's collector: it
   * recovers nothing, and the destination is never anchored — every action on the
   * new page then replays the page it came from.
   *
   * The replacement signal is the document's own `performance.timeOrigin`
   * changing, NOT the collector going missing. Under the preload every document
   * instruments itself at document-start, so the collector is never absent and
   * that older signal stood permanently false — the destination was then only
   * ever anchored by a drain that happened to be slow enough to land after the
   * navigation, and tightening that latency lost the destination page entirely.
   * A same-URL re-navigation is a new document and a new origin, so this covers
   * it too; a command that navigated nowhere polls out and costs one drain of an
   * empty buffer.
   *
   * The baseline is the last origin THIS capturer saw, never one read on entry.
   * Reading it here would compare the document against itself: a command that
   * completes AFTER its navigation committed (`browser.url` waits for load, so
   * that is the normal case) would baseline the destination and then report no
   * change, dropping the very anchor this exists to take. With no baseline yet
   * a navigation cannot be ruled out either, so the first DOM-mutating command
   * of a run anchors unconditionally rather than guessing — `captureCurrentDom`
   * is idempotent per document, so an already-anchored page costs one drain.
   */
  async anchorAfterNavigation(
    browser: NightwatchBrowser,
    timestamp?: number
  ): Promise<void> {
    // Polls the page for its own document identity, so there is nothing to
    // poll and nothing to anchor without one.
    if (this.isNativeAppSession) {
      return
    }
    const before = this.lastDocumentOrigin
    let born: number | undefined
    const replaced = await pollUntilReady(
      async () => {
        const now = await this.documentOrigin(browser)
        if (now === undefined) {
          return false
        }
        this.lastDocumentOrigin = now
        born = now
        return before === undefined || now !== before
      },
      { attempts: 5, intervalMs: 150 }
    )
    if (!replaced) {
      return
    }
    // Only a change from an origin this capturer already saw is a navigation; the
    // first observation has no baseline to have changed from. The newest page
    // capture is read here, after the poll: the click that caused the navigation
    // may have queued its capture while this poll was running, and the fill that
    // started the poll must never be re-stamped with the destination.
    const queued = this.#lastPageCapture
    let recapture: Promise<void> = Promise.resolve()
    if (
      timestamp !== undefined &&
      queued &&
      before !== undefined &&
      born !== undefined &&
      queued.timestamp >= timestamp &&
      queued.timestamp < born &&
      queued.timestamp !== this.#lastRecapturedAt
    ) {
      this.#lastRecapturedAt = queued.timestamp
      recapture = recaptureAfterNavigation({
        browser,
        runner: this.runner,
        snapshots: this.actionSnapshots,
        queued,
        isLatest: () => this.#lastPageCapture === queued
      })
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
    // A wait sent running is newest from its start, but it has not ended, so it
    // did not cause the navigation.
    const [drain] = await Promise.allSettled([
      this.captureTrace(browser, true, this.#newestEndedTimestamp()),
      recapture
    ])
    if (drain.status === 'rejected') {
      log.debug(`Post-navigation drain failed: ${errorMessage(drain.reason)}`)
    }
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
    if (this.isNativeAppSession) {
      return
    }
    try {
      // Several paths reach the same document (navigation proxy, drain
      // recovery); a bundle that finds a collector keeps it, so this probe
      // only saves the injection's round trips.
      const alreadyPresent = await webdriverExecute<boolean>(
        browser,
        COLLECTOR_READY_SCRIPT
      )
      if (alreadyPresent === true) {
        return
      }
      const scriptContent = await loadInjectableScript()
      // The appended script runs synchronously, so this usually answers ready.
      const injected = await webdriverExecute<boolean>(
        browser,
        COLLECTOR_INJECT_SCRIPT,
        [scriptContent]
      )

      const hasCollector =
        injected === true ||
        (await pollUntilReady(
          async () =>
            (await webdriverExecute<boolean>(
              browser,
              COLLECTOR_READY_SCRIPT
            )) === true,
          { checkFirst: true }
        ))

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
   * Parse Chrome performance logs to extract network request entries.
   * Requires loggingPrefs: { performance: 'ALL' } in Chrome capabilities.
   */
  async captureNetworkFromPerformanceLogs(browser: NightwatchBrowser) {
    // BiDi network inspector is the source of truth when attached.
    if (this.bidiActive || !this.perfLogsRequested) {
      return
    }
    // Off the queue: a queued `getLog` issued mid-command becomes that command's child and resolves its await early.
    const logs = await webdriverPost<PerfLogEntry[]>(browser, 'se/log', {
      type: 'performance'
    })
    if (!Array.isArray(logs) || logs.length === 0) {
      return
    }
    const networkEntries = parseNetworkFromPerfLogs(logs)
    if (networkEntries.length > 0) {
      this.#ingestPerfLogEntries(networkEntries)
    }
  }

  /** A log entry for a load the page already reported replaces that row in
   *  place, under the row's own id; the rest are appended once. */
  #ingestPerfLogEntries(entries: NetworkEntry[]): void {
    const { upgrades, fresh } = upgradeResourceTimingRows(
      entries,
      this.networkRequests
    )
    for (const { index, request } of upgrades) {
      this.networkRequests[index] = request
    }
    const deduped = dedupeNetworkRequests(
      fresh,
      this.networkRequests as NetworkEntry[]
    )
    // A perf-log entry that never saw its response event carries no type;
    // default it to the vocabulary's residual at this framework boundary.
    const appended = deduped.map((d) => ({ ...d, type: d.type ?? 'other' }))
    this.networkRequests.push(...appended)
    this.loadsListedByLog.push(
      ...appended.map(({ url, timestamp }) => ({ url, timestamp }))
    )
    const sent = [...upgrades.map((upgrade) => upgrade.request), ...appended]
    if (sent.length > 0) {
      this.sendUpstream('networkRequests', sent)
    }
  }

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
    // A native app has no document to drain, only the proxy's requests. Inside
    // the method, because the command hook and the navigation proxy both reach it.
    if (this.isNativeAppSession) {
      await this.nativeNetwork.forward({ throttle: true })
      return
    }
    // Performance logs only accumulate, so they lose nothing by waiting, while
    // the drain is racing the page it reads from (`drainOutgoingPage`).
    await this.drainCollector(browser, forceAnchor, anchorTimestamp)
    await this.captureNetworkFromPerformanceLogs(browser)
  }

  /** Rows after the last capture saw a state nothing captured; one more capture, stamped at that capture, shows the test's end. */
  async captureFinalFrame(): Promise<void> {
    if (this.traceMode !== 'trace') {
      return
    }
    await this.testCapture.captureEndFrame(
      this.commandsLog,
      this.snapshotCaptures,
      this.actionSnapshots,
      async (stamp) => {
        if (!this.#browser) {
          return null
        }
        return captureActionSnapshot(
          this.#browser,
          stamp.command,
          stamp.timestamp,
          this.runner,
          this.nativeApp,
          'final'
        )
      },
      (err) =>
        log.debug(`End-of-test frame capture failed: ${errorMessage(err)}`)
    )
  }

  /** At a test or scenario end, before its slice is written: the proxy drain there is never throttled. */
  async captureTraceAtTestEnd(browser: NightwatchBrowser) {
    if (this.isNativeAppSession) {
      await this.nativeNetwork.forward()
      return
    }
    // Anchored: a test ending on a navigation leaves the destination's async
    // initial anchor unrun, so its DOM would be absent from the slice.
    await this.captureTrace(browser, true)
    await this.pageResourceStore.settle(() =>
      this.drainCollector(browser, true)
    )
  }

  private async drainCollector(
    browser: NightwatchBrowser,
    forceAnchor: boolean,
    anchorTimestamp?: number
  ) {
    // Try the injected wdioTraceCollector script for XHR/fetch and mutations.
    // Atomic check+read — the inline `typeof === 'undefined' → null` guard is
    // the only safe form; a separate existence check would race page navigation
    // (the collector can disappear between the two round-trips).
    try {
      const traceData = await drainCollectorWithRecovery({
        drain: () =>
          webdriverExecute<Record<string, unknown> | null>(
            browser,
            collectorDrainExpression(
              forceAnchor,
              this.pageResourceStore.mode,
              this.pageResourceStore.storedKeys
            )
          ),
        injectIntoCurrentDocument: () => this.injectScript(browser),
        currentUrl: () =>
          webdriverExecute<string>(browser, 'return location.href;').then(
            (u) => u ?? undefined
          ),
        log: (level, message) => log[level](message)
      })

      // Spent whatever the drain found: the page observed a load before the
      // log listed it, so a row not in this drain is never coming, and a
      // document with no collector is one it died with.
      const listedByLog = this.loadsListedByLog
      this.loadsListedByLog = []
      if (!traceData) {
        return
      }

      // Gated on delivered BiDi events, never on a subscription (Appium's shim
      // accepts one and sends nothing) nor on the performance log, which is
      // read after this drain and upgrades the page's rows in place instead.
      this.processTracePayload(
        withoutLoadsTheLogListed(traceData, listedByLog),
        {
          anchorTimestamp,
          skipResourceTimingRequests: this.bidiNetworkObserved
        }
      )
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
