import logger from '@wdio/logger'
import { ScreencastRecorderBase, errorMessage } from '@wdio/devtools-core'
import { BLANK_FRAME_THRESHOLD_BYTES } from './constants.js'
import { getDriverOriginals } from './driverPatcher.js'
import type { SeleniumDriverLike } from './types.js'

const log = logger('@wdio/selenium-devtools:ScreencastRecorder')

/**
 * Selenium-specific screencast recorder. Inherits the frame buffer, polling
 * fallback, and public API from {@link ScreencastRecorderBase}; overrides the
 * CDP hooks to use selenium-webdriver's `createCDPConnection('page')` API and
 * listens directly on the underlying CDP WebSocket for `Page.screencastFrame`.
 */
export class ScreencastRecorder extends ScreencastRecorderBase<SeleniumDriverLike> {
  #cdp: any = undefined
  #cdpFrameListener: ((data: any) => void) | undefined

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

  protected override async tryStartCdp(): Promise<boolean> {
    const driver = this.driver
    if (!driver || typeof driver.createCDPConnection !== 'function') {
      return false
    }
    try {
      const cdp = await driver.createCDPConnection('page')
      this.#cdp = cdp

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
          this.pushCdpFrame(params.data, params.metadata?.timestamp)
          // Anchor frame 0 at the first content-bearing frame to trim the
          // leading about:blank dead-air. Approximate decoded size: base64
          // expands by ~33%, so multiply by 0.75 for a rough decoded byte count.
          if (!this.hasStartMarker) {
            const decodedSize = Math.floor((params.data?.length ?? 0) * 0.75)
            if (decodedSize >= BLANK_FRAME_THRESHOLD_BYTES) {
              this.markStartAtLatest()
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
        format: this.options.captureFormat,
        quality: this.options.quality,
        maxWidth: this.options.maxWidth,
        maxHeight: this.options.maxHeight
      })

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
      this.#cdp?.execute('Page.stopScreencast')
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
    log.info(`✓ Screencast stopped — ${this.buffer.length} frame(s) collected`)
    this.#cdp = undefined
    this.#cdpFrameListener = undefined
  }
}
