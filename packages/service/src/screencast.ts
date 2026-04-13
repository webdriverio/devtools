import logger from '@wdio/logger'

import { SCREENCAST_DEFAULTS } from './constants.js'
import type { ScreencastFrame, ScreencastOptions } from './types.js'

const log = logger('@wdio/devtools-service:ScreencastRecorder')

/**
 * Manages session screencast recording with automatic browser detection.
 *
 * Recording strategy (chosen automatically at start time):
 *   1. CDP push mode  — Chrome/Chromium only. Chrome pushes frames over the
 *      DevTools Protocol; each frame is ack'd immediately. Efficient with no
 *      impact on test command timing.
 *   2. BiDi polling   — all other browsers (Firefox, Safari, Edge Legacy, …).
 *      Falls back to calling browser.takeScreenshot() at a fixed interval.
 *      Works wherever WebDriver screenshots are supported; adds a small
 *      round-trip overhead proportional to pollIntervalMs.
 *
 * Usage:
 *   const recorder = new ScreencastRecorder(options)
 *   await recorder.start(browser)   // in before() hook
 *   // ... test runs ...
 *   await recorder.stop()           // in after() hook
 *   const frames = recorder.frames  // feed to encodeToVideo()
 */
export class ScreencastRecorder {
  #frames: ScreencastFrame[] = []
  /** Puppeteer CDPSession — set only in CDP mode. */
  #cdpSession: any = undefined
  /** setInterval handle — set only in polling mode. */
  #pollTimer: ReturnType<typeof setInterval> | undefined = undefined
  #isRecording = false
  #options: Required<ScreencastOptions>
  /**
   * Index into #frames where meaningful recording begins.
   * Frames before this index (blank browser before first navigation) are
   * excluded from encoding. Set once via setStartMarker().
   */
  #startIndex = 0
  #startMarkerSet = false

  constructor(options: ScreencastOptions = {}) {
    this.#options = { ...SCREENCAST_DEFAULTS, ...options }
  }

  // ─── public API ───────────────────────────────────────────────────────────

  /**
   * Start recording. Tries CDP (Chrome) first; falls back to BiDi polling
   * for all other browsers. Safe to call even if the browser does not support
   * screenshots — the failure is logged and recording is simply skipped.
   */
  async start(browser: WebdriverIO.Browser): Promise<void> {
    const cdpStarted = await this.#startCdp(browser)
    if (!cdpStarted) {
      await this.#startPolling(browser)
    }
  }

  /**
   * Stop recording and release resources.
   * Safe to call even if start() was never called or failed.
   */
  async stop(): Promise<void> {
    if (!this.#isRecording) {
      return
    }

    if (this.#cdpSession) {
      await this.#stopCdp()
    } else if (this.#pollTimer !== undefined) {
      this.#stopPolling()
    }

    this.#isRecording = false
  }

  /**
   * Mark the current frame position as the start of meaningful recording.
   * Frames captured before this call (blank browser, pre-navigation pauses)
   * are excluded from the encoded video.
   * Safe to call multiple times — only the first call takes effect.
   */
  setStartMarker() {
    if (!this.#startMarkerSet) {
      this.#startMarkerSet = true
      this.#startIndex = this.#frames.length
    }
  }

  /** Frames to encode — everything from the first meaningful action onwards. */
  get frames(): ScreencastFrame[] {
    return this.#frames.slice(this.#startIndex)
  }

  /**
   * Duration in milliseconds between first and last captured frame.
   * Returns 0 if fewer than 2 frames were collected.
   */
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

  // ─── CDP mode (Chrome/Chromium) ───────────────────────────────────────────

  /**
   * Attempt to start recording via the Chrome DevTools Protocol.
   * Returns true on success, false if CDP is unavailable (non-Chrome browser
   * or remote grid without debug-port access).
   */
  async #startCdp(browser: WebdriverIO.Browser): Promise<boolean> {
    try {
      const puppeteer = await (browser as any).getPuppeteer()
      const pages = await puppeteer.pages()
      if (!pages.length) {
        return false
      }

      const page = pages[0]
      this.#cdpSession = await page.createCDPSession()

      await this.#cdpSession.send('Page.startScreencast', {
        format: this.#options.captureFormat,
        quality: this.#options.quality,
        maxWidth: this.#options.maxWidth,
        maxHeight: this.#options.maxHeight
      })

      this.#cdpSession.on('Page.screencastFrame', async (event: any) => {
        // CDP timestamp is seconds (float); convert to ms.
        this.#frames.push({
          data: event.data,
          timestamp: Math.round(event.metadata.timestamp * 1000)
        })
        // Chrome stops sending frames if acks are not sent promptly.
        try {
          await this.#cdpSession.send('Page.screencastFrameAck', {
            sessionId: event.sessionId
          })
        } catch (ackErr) {
          log.warn(
            `Screencast: failed to ack frame — ${(ackErr as Error).message}`
          )
        }
      })

      this.#isRecording = true
      log.info('✓ Screencast recording started (CDP mode)')
      return true
    } catch {
      // CDP not available — caller will try polling fallback.
      return false
    }
  }

  async #stopCdp(): Promise<void> {
    try {
      await this.#cdpSession.send('Page.stopScreencast')
      log.info(
        `✓ Screencast stopped — ${this.#frames.length} frame(s) collected`
      )
    } catch (err) {
      const msg = (err as Error).message ?? ''
      if (msg.includes('Session closed') || msg.includes('Target closed')) {
        // Browser shut down before after() completed — frames already buffered.
        log.debug(
          'Screencast: CDP session already closed (expected during teardown)'
        )
      } else {
        log.warn(`Screencast: error stopping CDP — ${msg}`)
      }
    } finally {
      this.#cdpSession = undefined
    }
  }

  // ─── Polling mode (all other browsers) ───────────────────────────────────

  /**
   * Attempt to start recording via periodic browser.takeScreenshot() calls.
   * Works for any browser that supports WebDriver screenshots (Firefox,
   * Safari, etc.). Adds a small round-trip overhead per interval tick.
   */
  async #startPolling(browser: WebdriverIO.Browser): Promise<void> {
    try {
      // Capture one frame immediately to verify screenshots work before
      // committing to the polling loop.
      const firstShot = await browser.takeScreenshot()
      this.#frames.push({ data: firstShot, timestamp: Date.now() })

      const intervalMs = this.#options.pollIntervalMs
      this.#pollTimer = setInterval(async () => {
        try {
          const data = await browser.takeScreenshot()
          this.#frames.push({ data, timestamp: Date.now() })
        } catch {
          // Session ended mid-interval — stop polling gracefully.
          this.#stopPolling()
        }
      }, intervalMs)

      this.#isRecording = true
      log.info(
        `✓ Screencast recording started (polling mode, ${intervalMs} ms interval)`
      )
    } catch (err) {
      log.warn(
        `Screencast unavailable (${(err as Error).message}). ` +
          'Recording will be skipped.'
      )
    }
  }

  #stopPolling(): void {
    if (this.#pollTimer !== undefined) {
      clearInterval(this.#pollTimer)
      this.#pollTimer = undefined
      log.info(
        `✓ Screencast stopped — ${this.#frames.length} frame(s) collected`
      )
    }
  }
}
