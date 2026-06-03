import logger from '@wdio/logger'
import { ScreencastRecorderBase, errorMessage } from '@wdio/devtools-core'
import { BLANK_FRAME_THRESHOLD_BYTES } from './constants.js'
import { getDriverOriginals } from './driverPatcher.js'
import type { SeleniumDriverLike } from './types.js'

const log = logger('@wdio/selenium-devtools:ScreencastRecorder')

/** Selenium 4's CDP connection helper — shape stable across patch releases.
 *  IMPORTANT: `execute(method, params)` in selenium-webdriver is fire-and-
 *  forget — it writes to the underlying WebSocket and returns `undefined`,
 *  not a Promise. Don't await it and don't call `.then`/`.catch` on the
 *  return value. To know when Chrome actually starts pushing frames, gate
 *  on the first `Page.screencastFrame` message instead. */
interface SeleniumCdpWebSocket {
  on(event: 'message', listener: (data: unknown) => void): void
  off?: (event: 'message', listener: (data: unknown) => void) => void
}
interface SeleniumCdpConnection {
  _wsConnection?: SeleniumCdpWebSocket
  execute(method: string, params?: Record<string, unknown>): void
}

/** Max time to wait for Chrome's first screencast frame before declaring
 *  recording active anyway. Most tests see the first frame in <100ms; the
 *  ceiling protects against a totally unresponsive CDP target. */
const FIRST_FRAME_TIMEOUT_MS = 2000

/**
 * Selenium-specific screencast recorder. Inherits the frame buffer, polling
 * fallback, and public API from {@link ScreencastRecorderBase}; overrides the
 * CDP hooks to use selenium-webdriver's `createCDPConnection('page')` API and
 * listens directly on the underlying CDP WebSocket for `Page.screencastFrame`.
 */
export class ScreencastRecorder extends ScreencastRecorderBase<SeleniumDriverLike> {
  #cdp: SeleniumCdpConnection | undefined
  #cdpFrameListener: ((data: unknown) => void) | undefined
  /** Resolved by `#makeCdpFrameHandler` on the first arriving frame. Lets
   *  `tryStartCdp` await actual readiness instead of returning eagerly. */
  #firstFrameResolve: (() => void) | undefined

  protected override onPollingStarted(intervalMs: number): void {
    log.info(
      `✓ Screencast recording started (polling mode, ${intervalMs} ms interval)`
    )
  }

  protected override onPollingStopped(frameCount: number): void {
    log.info(`✓ Screencast stopped — ${frameCount} frame(s) collected`)
  }

  protected override onUnavailable(err: unknown): void {
    log.warn(
      `Screencast unavailable (${errorMessage(err)}). Recording skipped.`
    )
  }

  protected override async takeScreenshot(): Promise<string | null> {
    const driver = this.driver
    const takeShot = getDriverOriginals().takeScreenshot
    if (!driver || !takeShot) {
      return null
    }
    return takeShot(driver)
  }

  #makeCdpFrameHandler(cdp: SeleniumCdpConnection): (raw: unknown) => void {
    return (raw: unknown) => {
      let parsed: {
        method?: string
        params?: {
          data?: string
          sessionId?: number
          metadata?: { timestamp?: number }
        }
      }
      try {
        parsed = JSON.parse(String(raw))
      } catch {
        return // non-JSON message — ignore
      }
      if (parsed.method !== 'Page.screencastFrame') {
        return
      }
      const params = parsed.params ?? {}
      this.pushCdpFrame(params.data ?? '', params.metadata?.timestamp)
      // Anchor frame 0 at the first content-bearing frame to trim the
      // leading about:blank dead-air. Approximate decoded size: base64
      // expands by ~33%, so multiply by 0.75 for a rough decoded byte count.
      if (!this.hasStartMarker) {
        const decodedSize = Math.floor((params.data?.length ?? 0) * 0.75)
        if (decodedSize >= BLANK_FRAME_THRESHOLD_BYTES) {
          this.markStartAtLatest()
        }
      }
      // Tell tryStartCdp that Chrome is actively pushing frames now. Cleared
      // after firing so subsequent frames don't reach for a missing resolver.
      if (this.#firstFrameResolve) {
        this.#firstFrameResolve()
        this.#firstFrameResolve = undefined
      }
      // Chrome throttles/stops sending frames if acks lag — keep this fire-
      // and-forget but DON'T treat the return as a Promise. selenium-webdriver's
      // CDPConnection.execute() returns `undefined` synchronously, so any
      // .then/.catch on it throws a TypeError (was crashing test runs).
      if (params.sessionId !== undefined) {
        try {
          cdp.execute('Page.screencastFrameAck', {
            sessionId: params.sessionId
          })
        } catch (err) {
          log.warn(`Screencast: failed to ack frame — ${errorMessage(err)}`)
        }
      }
    }
  }

  protected override async tryStartCdp(): Promise<boolean> {
    const driver = this.driver
    if (!driver || typeof driver.createCDPConnection !== 'function') {
      return false
    }
    try {
      // selenium-webdriver types createCDPConnection() as Promise<unknown>;
      // the runtime shape is stable across patch releases and captured by
      // SeleniumCdpConnection above.
      const cdp = (await driver.createCDPConnection(
        'page'
      )) as SeleniumCdpConnection
      this.#cdp = cdp
      const ws = cdp._wsConnection
      if (!ws || typeof ws.on !== 'function') {
        log.warn('CDP connection has no underlying WebSocket — falling back')
        return false
      }
      const onMessage = this.#makeCdpFrameHandler(cdp)
      this.#cdpFrameListener = onMessage
      ws.on('message', onMessage)
      // Arm the first-frame promise BEFORE firing Page.startScreencast so we
      // don't miss the race where Chrome pushes its first frame before we
      // start awaiting.
      const firstFrame = new Promise<void>((resolve) => {
        this.#firstFrameResolve = resolve
      })
      // cdp.execute is fire-and-forget (returns void) in selenium-webdriver
      // — see the SeleniumCdpConnection comment above. Wait on the actual
      // first-frame arrival instead: that's the unambiguous signal that
      // Chrome is pushing. Timeout-capped so an unresponsive target falls
      // through to the polling path rather than hanging the test.
      cdp.execute('Page.startScreencast', {
        format: this.options.captureFormat,
        quality: this.options.quality,
        maxWidth: this.options.maxWidth,
        maxHeight: this.options.maxHeight
      })
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(resolve, FIRST_FRAME_TIMEOUT_MS)
      })
      await Promise.race([firstFrame, timeout])
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      this.#firstFrameResolve = undefined
      log.info('✓ Screencast recording started (CDP mode)')
      return true
    } catch (err) {
      log.info(
        `CDP screencast unavailable (${errorMessage(err)}); will try polling`
      )
      return false
    }
  }

  protected override async tryStopCdp(): Promise<void> {
    try {
      // cdp.execute is fire-and-forget (returns void) — see the
      // SeleniumCdpConnection comment. The buffer is already populated
      // synchronously by the frame handler; we just need to stop new frames
      // arriving. Session/Target-closed throws here are expected during
      // driver.quit teardown.
      this.#cdp?.execute('Page.stopScreencast')
    } catch (err) {
      const msg = errorMessage(err)
      if (
        msg.includes('Session closed') ||
        msg.includes('Target closed') ||
        msg.includes('no such session')
      ) {
        // expected during teardown
      } else {
        log.warn(`Screencast: error stopping CDP — ${msg}`)
      }
    }
    try {
      if (this.#cdpFrameListener && this.#cdp?._wsConnection?.off) {
        this.#cdp._wsConnection.off('message', this.#cdpFrameListener)
      }
    } catch {
      // detach best-effort
    }
    // If start was called but the first frame never arrived (timeout path),
    // the resolver is still set. Releasing it lets any pending Promise.race
    // unblock the test teardown cleanly.
    if (this.#firstFrameResolve) {
      this.#firstFrameResolve()
      this.#firstFrameResolve = undefined
    }
    log.info(`✓ Screencast stopped — ${this.buffer.length} frame(s) collected`)
    this.#cdp = undefined
    this.#cdpFrameListener = undefined
  }
}
