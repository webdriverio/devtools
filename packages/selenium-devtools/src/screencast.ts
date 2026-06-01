import logger from '@wdio/logger'
import { errorMessage } from '@wdio/devtools-core'
import {
  BLANK_FRAME_THRESHOLD_BYTES,
  SCREENCAST_DEFAULTS
} from './constants.js'
import { getDriverOriginals } from './driverPatcher.js'
import type {
  ScreencastFrame,
  ScreencastOptions,
  SeleniumDriverLike
} from './types.js'

const log = logger('@wdio/selenium-devtools:ScreencastRecorder')

// Two strategies:
//   1. CDP push (Chromium): listens to `Page.screencastFrame` events.
//   2. Polling fallback: calls unwrapped `takeScreenshot()` at pollIntervalMs.
// Frames buffer in memory and encode to WebM at stop().
export class ScreencastRecorder {
  #frames: ScreencastFrame[] = []
  #cdp: any = undefined
  #cdpFrameListener: ((data: any) => void) | undefined
  #pollTimer: ReturnType<typeof setInterval> | undefined
  #isRecording = false
  #options: Required<ScreencastOptions>
  #startIndex = 0
  #startMarkerSet = false

  constructor(options: ScreencastOptions = {}) {
    this.#options = { ...SCREENCAST_DEFAULTS, ...options }
  }

  async start(driver: SeleniumDriverLike): Promise<void> {
    if (this.#isRecording) {
      return
    }
    const cdpOk = await this.#startCdp(driver)
    if (!cdpOk) {
      await this.#startPolling(driver)
    }
  }

  async stop(): Promise<void> {
    if (!this.#isRecording) {
      return
    }
    if (this.#cdp) {
      await this.#stopCdp()
    } else if (this.#pollTimer !== undefined) {
      this.#stopPolling()
    }
    this.#isRecording = false
  }

  setStartMarker() {
    if (!this.#startMarkerSet) {
      this.#startMarkerSet = true
      this.#startIndex = this.#frames.length
    }
  }

  get frames(): ScreencastFrame[] {
    return this.#frames.slice(this.#startIndex)
  }

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

  // ─── CDP path (Chromium) ─────────────────────────────────────────────────

  async #startCdp(driver: SeleniumDriverLike): Promise<boolean> {
    if (typeof driver.createCDPConnection !== 'function') {
      return false
    }
    try {
      const cdp = await driver.createCDPConnection('page')
      this.#cdp = cdp

      // Listen for frames on the underlying WebSocket. Each CDP event arrives
      // as a JSON message with method='Page.screencastFrame' and embedded
      // params. We push to the frame buffer and ack so Chrome keeps streaming.
      const ws = cdp._wsConnection
      if (!ws || typeof ws.on !== 'function') {
        log.warn('CDP connection has no underlying WebSocket — falling back')
        return false
      }
      const onMessage = (raw: any) => {
        try {
          const payload = JSON.parse(raw.toString())
          if (payload.method !== 'Page.screencastFrame') {
            return
          }
          const params = payload.params || {}
          const ts =
            params.metadata?.timestamp !== undefined &&
            params.metadata?.timestamp !== null
              ? Math.round(params.metadata.timestamp * 1000)
              : Date.now()
          this.#frames.push({ data: params.data, timestamp: ts })
          // Anchor frame 0 at the first content-bearing frame to trim the
          // leading about:blank dead-air.
          if (!this.#startMarkerSet) {
            const decodedSize = Math.floor((params.data?.length ?? 0) * 0.75)
            if (decodedSize >= BLANK_FRAME_THRESHOLD_BYTES) {
              this.#startIndex = Math.max(0, this.#frames.length - 1)
              this.#startMarkerSet = true
            }
          }
          if (params.sessionId !== undefined) {
            cdp.execute('Page.screencastFrameAck', {
              sessionId: params.sessionId
            })
          }
        } catch {
          // ignore non-JSON / non-screencast messages
        }
      }
      this.#cdpFrameListener = onMessage
      ws.on('message', onMessage)

      cdp.execute('Page.startScreencast', {
        format: this.#options.captureFormat,
        quality: this.#options.quality,
        maxWidth: this.#options.maxWidth,
        maxHeight: this.#options.maxHeight
      })

      this.#isRecording = true
      log.info('✓ Screencast recording started (CDP mode)')
      return true
    } catch (err) {
      log.info(
        `CDP screencast unavailable (${errorMessage(err)}); will try polling`
      )
      return false
    }
  }

  async #stopCdp(): Promise<void> {
    try {
      this.#cdp.execute('Page.stopScreencast')
    } catch (err) {
      log.warn(`Screencast: error stopping CDP — ${errorMessage(err)}`)
    }
    try {
      if (this.#cdpFrameListener && this.#cdp?._wsConnection?.off) {
        this.#cdp._wsConnection.off('message', this.#cdpFrameListener)
      }
    } catch {
      // detach best-effort
    }
    log.info(`✓ Screencast stopped — ${this.#frames.length} frame(s) collected`)
    this.#cdp = undefined
    this.#cdpFrameListener = undefined
  }

  // ─── Polling fallback (any browser) ──────────────────────────────────────

  async #startPolling(driver: SeleniumDriverLike): Promise<void> {
    const takeShot = getDriverOriginals().takeScreenshot
    if (!takeShot) {
      log.warn('Screencast unavailable — driver lacks takeScreenshot')
      return
    }
    try {
      const first = await takeShot(driver)
      this.#frames.push({ data: first, timestamp: Date.now() })

      const intervalMs = this.#options.pollIntervalMs
      this.#pollTimer = setInterval(async () => {
        try {
          const data = await takeShot(driver)
          this.#frames.push({ data, timestamp: Date.now() })
        } catch {
          this.#stopPolling()
        }
      }, intervalMs)

      this.#isRecording = true
      log.info(
        `✓ Screencast recording started (polling mode, ${intervalMs} ms interval)`
      )
    } catch (err) {
      log.warn(
        `Screencast unavailable (${errorMessage(err)}). Recording skipped.`
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
