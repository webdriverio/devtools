import fs from 'node:fs/promises'
import { WebSocket } from 'ws'
import type {
  CommandLog,
  ConsoleLog,
  LogLevel,
  LogSource,
  Metadata,
  NetworkRequest
} from '@wdio/devtools-shared'
import { WS_PATHS, WS_SCOPE } from '@wdio/devtools-shared'
import {
  CONSOLE_METHODS,
  LOG_SOURCES,
  SPINNER_RE,
  createConsoleLogEntry,
  detectLogLevel,
  isInternalStreamLine,
  stripAnsi
} from './console.js'

/**
 * Foundation class for adapter SessionCapturers. Owns the cross-framework
 * scaffolding (WS connection, console/stream patching, command id
 * bookkeeping). Framework-specific event handling stays in subclasses.
 *
 * Step 2 of {@link file://./../../../SESSIONCAPTURER_EXTRACTION_PLAN.md}.
 * **Not yet consumed by any adapter** — published so a future session can
 * migrate adapter SessionCapturer classes one at a time.
 */

export interface SessionCapturerOptions {
  hostname?: string
  port?: number
}

type ConsoleMethod = (typeof CONSOLE_METHODS)[number]

export abstract class SessionCapturerBase {
  // ── State (mostly private; subclasses access shared ws via `this.ws`) ────
  /**
   * Exposed as `protected` so subclasses with framework-specific close/wait
   * semantics (e.g. nightwatch's `closeWebSocket` with timeout) can operate
   * on the socket directly. Default lifecycle is fully managed by the base.
   */
  protected ws: WebSocket | undefined
  #hasConnected = false
  #originalConsoleMethods: Record<ConsoleMethod, typeof console.log>
  #originalStdoutWrite = process.stdout.write.bind(process.stdout)
  #originalStderrWrite = process.stderr.write.bind(process.stderr)
  // Two flags (not one): prevents re-entrant capture when console.* writes to
  // stdout, OR when stream forwarding wants to log via console.
  #isCapturingConsole = false
  #isCapturingStream = false

  // Command bookkeeping — used by adapters that emit commands themselves
  // (nightwatch, selenium). The WDIO service adapter doesn't call sendCommand
  // (WDIO owns the command lifecycle), so this state is harmless overhead.
  // `protected` (not `#`) so subclasses can override the send/replace flow
  // while still sharing the counter and de-dup set with base helpers.
  protected commandCounter = 0
  protected sentCommandIds = new Set<number>()

  // Map of file path → source text. Populated by `captureSource` (also
  // accessed by adapter-specific source-discovery flows, e.g. service's
  // `ensureSourceLoaded` which parses `file://` locations first).
  sources = new Map<string, string>()

  // Captured trace payload — populated by `processTracePayload` (driven from
  // adapter-specific `captureTrace` flows) and by direct pushes from BiDi/CDP
  // listeners. Mutations stay `unknown[]` here because the canonical
  // `TraceMutation` shape is a browser-only DOM type (script package); cross-
  // package consumers treat the array as opaque.
  commandsLog: CommandLog[] = []
  consoleLogs: ConsoleLog[] = []
  networkRequests: NetworkRequest[] = []
  mutations: unknown[] = []
  traceLogs: string[] = []
  metadata?: Metadata

  // ── Construction ────────────────────────────────────────────────────────
  constructor(opts: SessionCapturerOptions = {}) {
    const { hostname, port } = opts
    if (hostname && port) {
      this.ws = new WebSocket(`ws://${hostname}:${port}${WS_PATHS.worker}`)
      this.ws.on('open', () => {
        this.#hasConnected = true
        this.onWsOpen()
      })
      this.ws.on('error', (err: unknown) => this.onWsError(err))
      this.ws.on('close', () => this.onWsClose())
      this.ws.on('message', (raw: Buffer | string) => {
        try {
          const parsed = JSON.parse(raw.toString())
          this.onWsMessage(parsed)
        } catch {
          // ignore non-JSON
        }
      })
    }

    this.#originalConsoleMethods = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────
  /**
   * Send a typed event to the dashboard. No-op if the WS isn't open. Catches
   * send-time exceptions so a transient socket error never aborts the host
   * runner. Subclasses that want diagnostics on drop or error override
   * {@link onUpstreamDrop}.
   */
  sendUpstream(event: string, data: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.onUpstreamDrop(event, 'closed')
      return
    }
    try {
      this.ws.send(JSON.stringify({ scope: event, data }))
    } catch (err) {
      this.onUpstreamDrop(event, 'send-error', err)
    }
  }

  /**
   * Hook fired when a {@link sendUpstream} call can't deliver. Default: silent
   * (matches the historical behavior of service/selenium). Nightwatch overrides
   * this to log a warning — useful when a runner drops mid-test and the user
   * needs to know why captured data is incomplete.
   */
  protected onUpstreamDrop(
    _event: string,
    _reason: 'closed' | 'send-error',
    _err?: unknown
  ): void {
    // no-op
  }

  /** True once the WS has opened at least once and is currently OPEN. */
  isConnected(): boolean {
    return Boolean(this.ws) && this.ws?.readyState === WebSocket.OPEN
  }

  /** Property-style alias for {@link isConnected} — used by tests that
   *  read it as a getter while mutating `ws.readyState` directly. */
  get isReportingUpstream(): boolean {
    return this.isConnected()
  }

  /** Subclasses can read this to gate retry/reconnect logic. */
  protected hasEverConnected(): boolean {
    return this.#hasConnected
  }

  /**
   * Send a CommandLog over the WS. If the entry already has an `_id` (set by
   * the adapter's `captureCommand` during buffering), use it; otherwise
   * allocate a fresh one. The `_id` is the de-dup key and is stripped from
   * the broadcast payload — it's adapter-internal bookkeeping.
   * Returns the id, or 0 if the entry had no `_id` and none could be assigned.
   */
  sendCommand(command: CommandLog & { _id?: number }): number {
    if (command._id === undefined) {
      command._id = this.commandCounter++
    }
    const id = command._id
    if (this.sentCommandIds.has(id)) {
      return id
    }
    this.sentCommandIds.add(id)
    const toSend = { ...command }
    delete toSend._id
    this.sendUpstream('commands', [toSend])
    return id
  }

  /**
   * Emit a `replaceCommand` event swapping an earlier entry in-place. Strips
   * the adapter-internal `_id` field before sending — that's bookkeeping for
   * the local `sentCommandIds` set and shouldn't reach the UI.
   */
  sendReplaceCommand(
    oldTimestamp: number,
    command: CommandLog & { _id?: number }
  ): void {
    const toSend = { ...command }
    delete toSend._id
    this.sendUpstream(WS_SCOPE.replaceCommand, {
      oldTimestamp,
      command: toSend
    })
  }

  /**
   * Read a file from disk, store in `sources`, and broadcast to the UI via
   * `sendUpstream('sources', { [path]: text })`. Idempotent — a cached path is
   * a no-op. Read errors are logged via `onSourceReadError` (default: silent)
   * so a missing source never aborts capture.
   */
  async captureSource(filePath: string): Promise<void> {
    if (this.sources.has(filePath)) {
      return
    }
    try {
      const source = (await fs.readFile(filePath, 'utf-8')).toString()
      this.sources.set(filePath, source)
      this.sendUpstream('sources', { [filePath]: source })
    } catch (err) {
      this.onSourceReadError(filePath, err)
    }
  }

  /**
   * Hook fired when `captureSource` can't read a file. Default: silent.
   * Subclasses (nightwatch, selenium) override to log a warning.
   */
  protected onSourceReadError(_filePath: string, _err: unknown): void {
    // no-op — service silently swallows; subclasses can opt into a log line.
  }

  /**
   * Ingest the `{ mutations, traceLogs, consoleLogs, networkRequests, metadata }`
   * payload returned by the page-side `wdioTraceCollector.getTraceData()`.
   * Tags console logs with `source: 'browser'`, pushes each array into the
   * matching local field, and broadcasts via the appropriate WS scopes.
   *
   * `skipConsoleLogs` / `skipNetworkRequests` opt out when an out-of-band
   * channel (BiDi) is already delivering those streams — without the gate
   * the dashboard would see each entry twice.
   */
  protected processTracePayload(
    payload: {
      mutations?: unknown
      traceLogs?: unknown
      consoleLogs?: unknown
      networkRequests?: unknown
      metadata?: unknown
    },
    opts: { skipConsoleLogs?: boolean; skipNetworkRequests?: boolean } = {}
  ): void {
    const { mutations, traceLogs, consoleLogs, networkRequests, metadata } =
      payload

    if (metadata && typeof metadata === 'object') {
      // Page-side trace data is a JS bag; only fields that match Metadata
      // survive at runtime, but TS can't prove that. Cast to Partial<Metadata>
      // so the merge stays type-checked while accepting incomplete payloads.
      this.metadata = {
        ...this.metadata,
        ...(metadata as Partial<Metadata>)
      } as Metadata
      this.sendUpstream('metadata', this.metadata)
    }

    if (
      !opts.skipConsoleLogs &&
      Array.isArray(consoleLogs) &&
      consoleLogs.length > 0
    ) {
      const tagged = (consoleLogs as ConsoleLog[]).map((entry) => ({
        ...entry,
        source: LOG_SOURCES.BROWSER as LogSource
      }))
      this.consoleLogs.push(...tagged)
      this.sendUpstream('consoleLogs', tagged)
    }

    if (
      !opts.skipNetworkRequests &&
      Array.isArray(networkRequests) &&
      networkRequests.length > 0
    ) {
      const reqs = networkRequests as NetworkRequest[]
      this.networkRequests.push(...reqs)
      this.sendUpstream('networkRequests', reqs)
    }

    if (Array.isArray(mutations) && mutations.length > 0) {
      this.mutations.push(...mutations)
      this.sendUpstream('mutations', mutations)
    }

    if (Array.isArray(traceLogs) && traceLogs.length > 0) {
      const logs = traceLogs as string[]
      this.traceLogs.push(...logs)
      this.sendUpstream('logs', logs)
    }
  }

  /**
   * Resolve when the WS reaches OPEN state, or `false` on timeout / error.
   * Returns immediately if already open. Used by adapters that need a
   * synchronization barrier before injecting page-side scripts.
   */
  async waitForConnection(timeoutMs = 5000): Promise<boolean> {
    if (!this.ws) {
      return false
    }
    if (this.ws.readyState === WebSocket.OPEN) {
      return true
    }
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), timeoutMs)
      this.ws!.once('open', () => {
        clearTimeout(timeout)
        resolve(true)
      })
      this.ws!.once('error', () => {
        clearTimeout(timeout)
        resolve(false)
      })
    })
  }

  /**
   * Gracefully close the WS, waiting up to 2s for buffered messages to flush.
   * Call before process exit in reuse mode (or after dashboard close) so the
   * backend sees a clean close instead of an abrupt TCP reset.
   */
  async closeWebSocket(): Promise<void> {
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      return
    }
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 2000)
      this.ws!.once('close', () => {
        clearTimeout(timeout)
        resolve()
      })
      this.ws!.close()
    })
  }

  /**
   * Restore console/streams. Does NOT close the WS — that's the subclass's
   * call (see `closeWebSocket` on nightwatch/selenium). Closing here would
   * break the wait-for-dashboard-close flow, since the worker WS is the
   * channel the backend uses to signal `clientDisconnected`.
   */
  cleanup(): void {
    this.restoreConsole()
    this.restoreStreams()
  }

  // ── Patching (call from subclass constructor) ───────────────────────────
  /** Patch `console.log/info/warn/error` to forward through `onLine`. */
  protected patchConsole(): void {
    CONSOLE_METHODS.forEach((method) => {
      const original = this.#originalConsoleMethods[method]
      console[method] = (...args: any[]) => {
        this.#isCapturingConsole = true
        const result = original.apply(console, args)
        this.#isCapturingConsole = false

        const serialized = args.map((a) =>
          typeof a === 'object' && a !== null ? safeStringify(a) : String(a)
        )
        const joined = stripAnsi(serialized.join(' ')).trim()
        if (!joined || this.isInternalStreamLine(joined)) {
          return result
        }
        // Pass the per-arg serialized array (`['payload', '{"x":1}']`) rather
        // than the joined string. The dashboard's `#formatArgs` joins on its
        // own; preserving the array form is lossless and lets future consumers
        // group/style individual args.
        this.onLine(method as LogLevel, serialized, LOG_SOURCES.TEST)
        return result
      }
    })
  }

  /**
   * Wrap `process.stdout.write` and `process.stderr.write` to forward chunks
   * through `onLine`. The base's `#isCapturingConsole` flag prevents
   * re-entrance when console patching itself writes to stdout.
   */
  protected patchStreams(): void {
    const captureChunk = (raw: string | Uint8Array) => {
      if (this.#isCapturingStream) {
        return
      }
      const text = typeof raw === 'string' ? raw : raw.toString()
      if (!text?.trim()) {
        return
      }
      this.#isCapturingStream = true
      try {
        for (const rawLine of text.split('\n')) {
          // Strip CR-overwrites so progress bars don't show partial frames.
          const segments = rawLine.split('\r').filter((s) => s.trim())
          const lastSegment = segments[segments.length - 1] ?? rawLine
          const clean = stripAnsi(lastSegment).trim()
          if (
            !clean ||
            this.isInternalStreamLine(clean) ||
            SPINNER_RE.test(clean)
          ) {
            continue
          }
          this.onLine(detectLogLevel(clean), [clean], LOG_SOURCES.TERMINAL)
        }
      } finally {
        this.#isCapturingStream = false
      }
    }

    const wrap = (
      stream: NodeJS.WriteStream,
      original: (...a: any[]) => boolean
    ) => {
      const capturer = this
      // `stream.write` has Node's multi-overload signature that's hard to
      // satisfy with a single function expression — cast to the stream's
      // own `write` member type rather than `any`.
      stream.write = function (chunk: unknown, ...rest: unknown[]): boolean {
        const result = original.call(stream, chunk, ...rest)
        if (chunk && !capturer.#isCapturingConsole) {
          captureChunk(chunk as string | Uint8Array)
        }
        return result
      } as typeof stream.write
    }

    wrap(process.stdout, this.#originalStdoutWrite)
    wrap(process.stderr, this.#originalStderrWrite)
  }

  protected restoreConsole(): void {
    CONSOLE_METHODS.forEach((method) => {
      console[method] = this.#originalConsoleMethods[method]
    })
  }

  protected restoreStreams(): void {
    // Restoring the pre-patch references — the typed write signature differs
    // slightly from the runtime instance type after `.bind()`, hence the cast
    // through the stream's own `write` member type.
    process.stdout.write = this
      .#originalStdoutWrite as typeof process.stdout.write
    process.stderr.write = this
      .#originalStderrWrite as typeof process.stderr.write
  }

  // ── Hooks (subclasses override) ─────────────────────────────────────────
  /**
   * Default: forward a single ConsoleLog via the `consoleLogs` scope.
   * Args is passed as an array (matching the original console.* call shape:
   * `console.log('a', 'b')` → `args = ['a', 'b']`) so subclasses can preserve
   * the multi-argument structure for the UI.
   *
   * Subclasses that need to maintain local capture state (for the rerun/
   * replay flow) should override to also push the entry into their own
   * array — see service's onLine override.
   */
  protected onLine(type: LogLevel, args: string[], source: LogSource): void {
    const entry = createConsoleLogEntry(type, args, source)
    this.sendUpstream('consoleLogs', [entry])
  }

  /**
   * Default delegates to {@link isInternalStreamLine} from `./console.js`.
   * Subclasses can override to add framework-specific filters.
   */
  protected isInternalStreamLine(line: string): boolean {
    return isInternalStreamLine(line)
  }

  /** Hook: WS opened. Subclasses override to send a handshake, etc. */
  protected onWsOpen(): void {}

  /** Hook: WS errored before opening (likely no backend listening). */
  protected onWsError(_err: unknown): void {}

  /** Hook: WS closed (after open, or as a result of cleanup). */
  protected onWsClose(): void {}

  /**
   * Hook: WS message received from the backend. Currently used by selenium's
   * `awaitClientConnected` to know when a dashboard tab has subscribed.
   */
  protected onWsMessage(_msg: unknown): void {}
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
