import logger from '@wdio/logger'
import {
  ScreencastRecorderBase,
  errorMessage,
  withTimeout,
  SCREENCAST_HANDSHAKE_TIMEOUT_MS
} from '@wdio/devtools-core'

const log = logger('@wdio/devtools-service:ScreencastRecorder')

const CDP_TIMEOUT = Symbol('cdp-timeout')

interface CdpSessionLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
  on(event: string, handler: (event: unknown) => void | Promise<void>): void
  detach?(): Promise<void>
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

  /**
   * Run the CDP handshake under the handshake ceiling. Returns the session only
   * once it has been asked to start screencasting: a handshake that times out
   * must leave nothing armed for a later stop to find, or for a frame listener
   * to latch onto.
   */
  async #openCdpSession(): Promise<CdpSessionLike | undefined> {
    // getPuppeteer is augmented onto WebdriverIO.Browser in types.ts; the
    // returned Puppeteer object isn't typed by WDIO, so narrow it locally.
    const raw = await withTimeout(
      Promise.resolve(this.driver?.getPuppeteer?.()),
      SCREENCAST_HANDSHAKE_TIMEOUT_MS,
      undefined
    )
    if (!raw) {
      return undefined
    }
    const pages = await withTimeout(
      (raw as PuppeteerLike).pages(),
      SCREENCAST_HANDSHAKE_TIMEOUT_MS,
      []
    )
    if (!pages.length) {
      return undefined
    }

    const sessionPromise = pages[0].createCDPSession()
    const session = await withTimeout<CdpSessionLike | undefined>(
      sessionPromise,
      SCREENCAST_HANDSHAKE_TIMEOUT_MS,
      undefined
    )
    if (!session) {
      this.#detachWhenItLands(sessionPromise)
      return undefined
    }

    const started = await withTimeout<unknown>(
      session.send('Page.startScreencast', {
        format: this.options.captureFormat,
        quality: this.options.quality,
        maxWidth: this.options.maxWidth,
        maxHeight: this.options.maxHeight
      }),
      SCREENCAST_HANDSHAKE_TIMEOUT_MS,
      CDP_TIMEOUT
    )
    if (started === CDP_TIMEOUT) {
      log.warn('Screencast: CDP handshake timed out — falling back to polling')
      await this.#discardSession(session)
      return undefined
    }
    return session
  }

  /** The send may still have reached Chrome; drop the session so an armed
   *  screencast cannot push frames nobody will ack. */
  async #discardSession(session: CdpSessionLike): Promise<void> {
    try {
      await withTimeout(
        Promise.resolve(session.detach?.()),
        SCREENCAST_HANDSHAKE_TIMEOUT_MS,
        undefined
      )
    } catch {
      // best-effort — the session may already be gone
    }
  }

  /** A session that completes after the ceiling belongs to nobody — detach it
   *  when it lands so it cannot linger for the page's life. */
  #detachWhenItLands(session: Promise<CdpSessionLike>): void {
    session.then((late) => late?.detach?.()).catch(() => undefined)
  }

  protected override async tryStartCdp(): Promise<boolean> {
    if (!this.driver) {
      return false
    }
    try {
      const session = await this.#openCdpSession()
      if (!session) {
        return false
      }
      this.#cdpSession = session

      session.on('Page.screencastFrame', async (rawEvent) => {
        // A timed-out Page.stopScreencast leaves this session live; frames
        // arriving after teardown belong to no recording.
        if (this.#cdpSession !== session) {
          return
        }
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
      await withTimeout(
        session.send('Page.stopScreencast'),
        SCREENCAST_HANDSHAKE_TIMEOUT_MS,
        undefined
      )
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
