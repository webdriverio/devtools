import logger from '@wdio/logger'
import {
  type BidiHandlerSinks,
  attachBidiHandlers as attachBidiHandlersCore
} from '@wdio/devtools-core'
import type { SessionCapturer } from './session.js'

const log = logger('@wdio/nightwatch-devtools:bidi')

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

/**
 * Build sinks that route BiDi events into the SessionCapturer's local arrays
 * and broadcast them upstream. Mirrors selenium-devtools' `buildBidiSinks` —
 * separate per-adapter because the SessionCapturer concrete types differ.
 */
export function buildBidiSinks(capturer: SessionCapturer): BidiHandlerSinks {
  return {
    pushConsoleLog: (entry) => {
      capturer.consoleLogs.push(entry)
      capturer.sendUpstream('consoleLogs', [entry])
    },
    pushNetworkRequest: (entry) => {
      capturer.networkRequests.push(entry)
      capturer.sendUpstream('networkRequests', [entry])
    },
    replaceNetworkRequest: (id, entry) => {
      const idx = capturer.networkRequests.findIndex(
        (r: { id?: string }) => r.id === id
      )
      if (idx !== -1) {
        capturer.networkRequests[idx] = entry
      } else {
        capturer.networkRequests.push(entry)
      }
      capturer.sendUpstream('networkRequests', [entry])
    }
  }
}
