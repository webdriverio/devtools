import { WebSocket } from 'ws'
import type { CommandLog, LogLevel, LogSource } from '@wdio/devtools-shared'
import { WS_PATHS } from '@wdio/devtools-shared'
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

  /** Subclasses can read this to gate retry/reconnect logic. */
  protected hasEverConnected(): boolean {
    return this.#hasConnected
  }

  /**
   * Buffer/send a CommandLog with a stable internal id (the assigned id is
   * stamped onto the command's `_id` field). De-dupes — sending the same id
   * twice is a no-op.
   */
  sendCommand(command: CommandLog & { _id?: number }): number {
    const id = this.commandCounter++
    command._id = id
    if (this.sentCommandIds.has(id)) {
      return id
    }
    this.sentCommandIds.add(id)
    this.sendUpstream('commands', [command])
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
    this.sendUpstream('replaceCommand', { oldTimestamp, command: toSend })
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
      stream.write = function (chunk: any, ...rest: any[]): boolean {
        const result = original.call(stream, chunk, ...rest)
        if (chunk && !capturer.#isCapturingConsole) {
          captureChunk(chunk)
        }
        return result
      } as any
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
    process.stdout.write = this.#originalStdoutWrite as any
    process.stderr.write = this.#originalStderrWrite as any
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
