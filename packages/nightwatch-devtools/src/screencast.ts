import logger from '@wdio/logger'
import { ScreencastRecorderBase, errorMessage } from '@wdio/devtools-core'
import type { NightwatchBrowser } from './types.js'

const log = logger('@wdio/nightwatch-devtools:ScreencastRecorder')

/**
 * Nightwatch screencast recorder. Polling-only — Nightwatch doesn't expose a
 * stable CDP escape hatch the way WDIO (getPuppeteer) and Selenium
 * (createCDPConnection) do, so we don't override the CDP hooks. Polling works
 * on every browser Nightwatch supports.
 */
export class ScreencastRecorder extends ScreencastRecorderBase<NightwatchBrowser> {
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
    const browser = this.driver
    if (!browser) {
      return null
    }
    try {
      // Nightwatch's browser.takeScreenshot resolves to a base64 PNG string
      // (W3C-wrapped or flat depending on the driver). The cast is the
      // dynamic-command-bag widening we already do for browser methods.
      const result = await (
        browser as unknown as Record<string, () => Promise<unknown>>
      ).takeScreenshot()
      if (typeof result === 'string') {
        return result
      }
      if (
        result &&
        typeof result === 'object' &&
        typeof (result as { value?: unknown }).value === 'string'
      ) {
        return (result as { value: string }).value
      }
      return null
    } catch {
      return null
    }
  }
}
