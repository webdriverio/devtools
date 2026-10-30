import logger from '@wdio/logger'
import {
  ScreencastRecorderBase,
  type ScreencastLogger
} from '@wdio/devtools-core'
import type { ScreencastOptions } from '@wdio/devtools-shared'
import type { SessionCapturer } from './session.js'
import type { NightwatchBrowser } from './types.js'

const log = logger('@wdio/nightwatch-devtools:ScreencastRecorder')

/**
 * Nightwatch screencast recorder. Polling-only — Nightwatch doesn't expose a
 * stable CDP escape hatch the way WDIO (getPuppeteer) and Selenium
 * (createCDPConnection) do.
 *
 * `browser.takeScreenshot()` goes through Nightwatch's command queue and is
 * unreliable for polling (the existing code has `takeScreenshotViaHttp` for
 * the same reason — see session.ts). The recorder delegates to that helper
 * instead so screenshots fire directly over the WebDriver HTTP transport.
 */
export class ScreencastRecorder extends ScreencastRecorderBase<NightwatchBrowser> {
  readonly #sessionCapturer: SessionCapturer

  constructor(sessionCapturer: SessionCapturer, options: ScreencastOptions) {
    super(options)
    this.#sessionCapturer = sessionCapturer
  }

  protected override readonly logger: ScreencastLogger = log

  protected override async takeScreenshot(): Promise<string | null> {
    const browser = this.driver
    if (!browser) {
      return null
    }
    return this.#sessionCapturer.takeScreenshotViaHttp(browser)
  }
}
