import logger from '@wdio/logger'
import { ScreencastRecorderBase, errorMessage } from '@wdio/devtools-core'

const log = logger('@wdio/devtools-service:ScreencastRecorder')

interface CdpSessionLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
  on(event: string, handler: (event: unknown) => void | Promise<void>): void
}

interface PuppeteerPageLike {
  createCDPSession(): Promise<CdpSessionLike>
}

interface PuppeteerLike {
  pages(): Promise<PuppeteerPageLike[]>
}

/**
 * WDIO-specific screencast recorder. Inherits the frame buffer, polling
 * fallback, and public API from {@link ScreencastRecorderBase}; overrides the
 * CDP hooks to use WDIO's Puppeteer escape hatch (`browser.getPuppeteer()`).
 */
export class ScreencastRecorder extends ScreencastRecorderBase<WebdriverIO.Browser> {
  #cdpSession: CdpSessionLike | undefined = undefined

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
    if (!this.driver) {
      return null
    }
    return this.driver.takeScreenshot()
  }

  protected override async tryStartCdp(): Promise<boolean> {
    if (!this.driver) {
      return false
    }
    try {
      // getPuppeteer is augmented onto WebdriverIO.Browser in types.ts; the
      // returned Puppeteer object isn't typed by WDIO, so narrow it locally.
      const raw = await this.driver.getPuppeteer?.()
      if (!raw) {
        return false
      }
      const puppeteer = raw as PuppeteerLike
      const pages = await puppeteer.pages()
      if (!pages.length) {
        return false
      }

      const page = pages[0]
      const session = await page.createCDPSession()
      this.#cdpSession = session

      await session.send('Page.startScreencast', {
        format: this.options.captureFormat,
        quality: this.options.quality,
        maxWidth: this.options.maxWidth,
        maxHeight: this.options.maxHeight
      })

      session.on('Page.screencastFrame', async (rawEvent) => {
        const event = rawEvent as {
          data: string
          metadata: { timestamp: number }
          sessionId?: number
        }
        this.pushCdpFrame(event.data, event.metadata.timestamp)
        // Chrome stops sending frames if acks are not sent promptly.
        try {
          await session.send('Page.screencastFrameAck', {
            sessionId: event.sessionId
          })
        } catch (ackErr) {
          log.warn(`Screencast: failed to ack frame — ${errorMessage(ackErr)}`)
        }
      })

      log.info('✓ Screencast recording started (CDP mode)')
      return true
    } catch {
      // CDP not available — caller will try polling fallback.
      return false
    }
  }

  protected override async tryStopCdp(): Promise<void> {
    const session = this.#cdpSession
    if (!session) {
      return
    }
    try {
      await session.send('Page.stopScreencast')
      log.info(
        `✓ Screencast stopped — ${this.buffer.length} frame(s) collected`
      )
    } catch (err) {
      const msg = errorMessage(err)
      if (msg.includes('Session closed') || msg.includes('Target closed')) {
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
}
