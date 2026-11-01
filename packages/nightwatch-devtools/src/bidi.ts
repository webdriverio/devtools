import logger from '@wdio/logger'
import {
  type BidiHandlerSinks,
  attachBidiHandlers as attachBidiHandlersCore
} from '@wdio/devtools-core'

const log = logger('@wdio/nightwatch-devtools:bidi')

export { buildBidiSinks } from '@wdio/devtools-core'

/**
 * Nightwatch wrapper around the core BiDi attach helper. Nightwatch ships
 * selenium-webdriver under the hood (via chromedriver), so the same
 * `selenium-webdriver/bidi` inspectors selenium-devtools uses are available
 * whenever the user has set `webSocketUrl: true` in their capabilities.
 *
 * Opt-in via the plugin's `bidi: true` option. When attached, the per-command
 * Chrome performance-log network capture is gated off to avoid duplicate
 * entries in the dashboard.
 */
export async function attachBidiHandlers(
  driver: unknown,
  sinks: BidiHandlerSinks
): Promise<boolean> {
  return attachBidiHandlersCore(driver, sinks, (level, message) =>
    log[level](message)
  )
}
