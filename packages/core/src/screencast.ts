import type { ScreencastFrame, ScreencastOptions } from '@wdio/devtools-shared'
import { SCREENCAST_DEFAULTS } from '@wdio/devtools-shared'

/**
 * Shared screencast scaffolding consumed by every adapter (service, selenium,
 * nightwatch). Owns the frame buffer, public API (start/stop/setStartMarker,
 * frames/duration/isRecording getters) and the polling fallback. Subclasses
 * provide framework-specific driver access:
 *
 *   - `takeScreenshot()` — required. Used by the polling path.
 *   - `tryStartCdp() / tryStopCdp()` — optional CDP push-mode override.
 *     Default returns false → falls through to polling.
 *
 * Adapters that have a stable CDP escape hatch (WDIO via getPuppeteer,
 * Selenium via createCDPConnection) override the CDP hooks. Nightwatch
 * inherits the polling-only default — works on every browser Nightwatch
 * supports without extra plumbing.
 */
export abstract class ScreencastRecorderBase<TDriver = unknown> {
  protected buffer: ScreencastFrame[] = []
  protected options: Required<ScreencastOptions>
  protected driver?: TDriver
  #pollTimer: ReturnType<typeof setInterval> | undefined
  #isRecording = false
  #cdpActive = false
  #startIndex = 0
  #startMarkerSet = false

  constructor(options: ScreencastOptions = {}) {
    this.options = { ...SCREENCAST_DEFAULTS, ...options }
  }

  /**
   * Start recording. Tries the CDP fast-path first (if the subclass overrode
   * `tryStartCdp`); falls back to screenshot polling otherwise. Safe to call
   * even if the browser doesn't support screenshots — failures are logged and
   * recording is simply skipped.
   */
  async start(driver: TDriver): Promise<void> {
    if (this.#isRecording) {
      return
    }
    this.driver = driver
    const cdpOk = await this.tryStartCdp()
    if (cdpOk) {
      this.#cdpActive = true
      this.#isRecording = true
      return
    }
    await this.#startPolling()
  }

  /**
   * Stop recording and release resources. Safe to call even if start() was
   * never called or failed.
   */
  async stop(): Promise<void> {
    if (!this.#isRecording) {
      return
    }
    if (this.#cdpActive) {
      await this.tryStopCdp()
      this.#cdpActive = false
    } else if (this.#pollTimer !== undefined) {
      this.#stopPolling()
    }
    this.#isRecording = false
  }

  /**
   * Mark the current frame position as the start of meaningful recording.
   * Frames captured before this call (blank browser, pre-navigation pauses)
   * are excluded from `frames`. Idempotent — only the first call takes effect.
   */
  setStartMarker(): void {
    if (!this.#startMarkerSet) {
      this.#startMarkerSet = true
      this.#startIndex = this.buffer.length
    }
  }

  /** Frames to encode — everything from the first meaningful action onwards. */
  get frames(): ScreencastFrame[] {
    return this.buffer.slice(this.#startIndex)
  }

  /** Duration in ms between first and last captured frame. Zero if <2 frames. */
  get duration(): number {
    const f = this.frames
    if (f.length < 2) {
      return 0
    }
    return f[f.length - 1].timestamp - f[0].timestamp
  }

  get isRecording(): boolean {
    return this.#isRecording
  }

  // ─── Subclass hooks ──────────────────────────────────────────────────────

  /**
   * Capture a single screenshot via the framework's driver API. Used by the
   * polling fallback. Return `null` to indicate a transient failure (loop
   * continues); throw to abort polling entirely.
   */
  protected abstract takeScreenshot(): Promise<string | null>

  /**
   * Try to start CDP push-mode recording. Return `true` on success. Default
   * returns `false` → caller falls back to polling. Subclasses that wire CDP
   * push themselves (WDIO via Puppeteer, Selenium via createCDPConnection)
   * override and push frames into `this.frames` directly when CDP fires.
   */
  protected async tryStartCdp(): Promise<boolean> {
    return false
  }

  /** Stop the CDP push-mode session started by `tryStartCdp`. */
  protected async tryStopCdp(): Promise<void> {
    // no-op
  }

  /**
   * Helper for CDP subclasses: push a frame onto the buffer with the right
   * timestamp normalization (CDP gives seconds-as-float; we store ms).
   */
  protected pushCdpFrame(data: string, timestampSeconds?: number): void {
    const timestamp =
      typeof timestampSeconds === 'number'
        ? Math.round(timestampSeconds * 1000)
        : Date.now()
    this.#appendFrame({ data, timestamp })
  }

  /**
   * Append a frame, decimating the buffer in place once it exceeds
   * `maxBufferFrames` so a long session can't grow it without bound.
   */
  #appendFrame(frame: ScreencastFrame): void {
    this.buffer.push(frame)
    // Decimation always keeps the first and last frame, so 2 is the hard floor;
    // clamp so a nonsensical sub-2 cap is honored as 2 rather than never firing.
    if (this.buffer.length > Math.max(2, this.options.maxBufferFrames)) {
      this.#decimateBuffer()
    }
  }

  /**
   * Halve the buffer by keeping every other frame plus the first and last, so
   * memory is bounded while the temporal spread survives (never tail-truncated).
   * `#startIndex` is remapped to the count of surviving pre-marker frames, which
   * keeps `frames`/`duration` excluding pre-marker frames across decimation.
   */
  #decimateBuffer(): void {
    const lastIndex = this.buffer.length - 1
    const kept: ScreencastFrame[] = []
    let preMarkerKept = 0
    for (let i = 0; i < this.buffer.length; i++) {
      if (i % 2 === 0 || i === lastIndex) {
        if (i < this.#startIndex) {
          preMarkerKept++
        }
        kept.push(this.buffer[i])
      }
    }
    this.buffer = kept
    this.#startIndex = preMarkerKept
  }

  /** Whether `setStartMarker` (or `markStartAtLatest`) has fired yet. */
  protected get hasStartMarker(): boolean {
    return this.#startMarkerSet
  }

  /**
   * Anchor the start marker to the most recently pushed frame. Used by
   * subclasses that detect the first content-bearing frame heuristically
   * (e.g. selenium's blank-frame-byte-size threshold) and want to skip the
   * preceding about:blank dead-air without waiting for an explicit caller.
   */
  protected markStartAtLatest(): void {
    if (!this.#startMarkerSet) {
      this.#startMarkerSet = true
      this.#startIndex = Math.max(0, this.buffer.length - 1)
    }
  }

  // ─── Polling implementation ─────────────────────────────────────────────

  /**
   * Hook fired when the polling loop starts. Default: no-op. Subclasses
   * (adapters with their own logger) override to surface visibility.
   */
  protected onPollingStarted(_intervalMs: number): void {
    // no-op
  }

  /** Hook fired when polling stops cleanly (driver still alive at the time). */
  protected onPollingStopped(_frameCount: number): void {
    // no-op
  }

  /** Hook fired when the polling fallback couldn't even take the first shot. */
  protected onUnavailable(_err: unknown): void {
    // no-op
  }

  // ─── Polling implementation ─────────────────────────────────────────────

  async #startPolling(): Promise<void> {
    try {
      const first = await this.takeScreenshot()
      if (first === null) {
        this.onUnavailable(new Error('first screenshot returned null'))
        return
      }
      this.#appendFrame({ data: first, timestamp: Date.now() })

      const intervalMs = this.options.pollIntervalMs
      this.#pollTimer = setInterval(async () => {
        try {
          const data = await this.takeScreenshot()
          if (data !== null) {
            this.#appendFrame({ data, timestamp: Date.now() })
          }
        } catch {
          // Session ended mid-interval — stop polling gracefully.
          this.#stopPolling()
        }
      }, intervalMs)

      this.#isRecording = true
      this.onPollingStarted(intervalMs)
    } catch (err) {
      this.onUnavailable(err)
    }
  }

  #stopPolling(): void {
    if (this.#pollTimer !== undefined) {
      clearInterval(this.#pollTimer)
      this.#pollTimer = undefined
      this.onPollingStopped(this.buffer.length)
    }
  }
}
