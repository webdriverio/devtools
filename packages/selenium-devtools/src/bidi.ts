import logger from '@wdio/logger'
import {
  type BidiHandlerSinks,
  attachBidiHandlers as attachBidiHandlersCore,
  errorMessage
} from '@wdio/devtools-core'
import type { SessionCapturer } from './session.js'

const log = logger('@wdio/selenium-devtools:bidi')

// Generic BiDi attach/load helpers live in @wdio/devtools-core; re-exported
// here so existing internal imports from './bidi.js' continue to resolve.
export {
  arrayHeadersToObject,
  loadSeleniumSubmodule,
  type BidiHandlerSinks
} from '@wdio/devtools-core'

// Sets webSocketUrl=true so the driver actually exposes the BiDi channel.
// Selenium-specific because it operates on the selenium-webdriver Builder.
/** Minimal shape of a selenium-webdriver `Builder` we touch. */
interface CapabilitiesLike {
  get?: (key: string) => unknown
  set?: (key: string, value: unknown) => void
  has?: (key: string) => boolean
}
interface BuilderLike {
  getCapabilities?: () => CapabilitiesLike | null | undefined
}

function asBuilder(value: unknown): BuilderLike | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  return value as BuilderLike
}

export function ensureBidiCapability(rawBuilder: unknown): void {
  const builder = asBuilder(rawBuilder)
  if (!builder) {
    return
  }
  try {
    const caps =
      typeof builder?.getCapabilities === 'function'
        ? builder.getCapabilities()
        : null
    if (!caps || typeof caps.set !== 'function') {
      return
    }
    if (typeof caps.has === 'function' && caps.has('webSocketUrl')) {
      return
    }
    caps.set('webSocketUrl', true)
    log.info('Set webSocketUrl=true on builder capabilities (BiDi enabled)')
  } catch (err) {
    log.warn(`Failed to set webSocketUrl capability: ${errorMessage(err)}`)
  }
}

// `--headless=old` (not `=new`) — `new` produces all-black frames under
// CDP `Page.startScreencast` on macOS (upstream Chrome bug).
// Selenium-specific because it operates on the selenium-webdriver Builder.
export function ensureHeadlessChrome(rawBuilder: unknown): void {
  const builder = asBuilder(rawBuilder)
  if (!builder) {
    return
  }
  try {
    const caps =
      typeof builder?.getCapabilities === 'function'
        ? builder.getCapabilities()
        : null
    if (
      !caps ||
      typeof caps.get !== 'function' ||
      typeof caps.set !== 'function'
    ) {
      return
    }
    const existing = (caps.get('goog:chromeOptions') ?? {}) as {
      args?: unknown
      [k: string]: unknown
    }
    const args: string[] = Array.isArray(existing.args)
      ? (existing.args as string[]).slice()
      : []
    const hasHeadless = args.some(
      (a) => typeof a === 'string' && a.startsWith('--headless')
    )
    if (hasHeadless) {
      return
    }
    args.push('--headless=old')
    caps.set('goog:chromeOptions', { ...existing, args })
    log.info('Injected --headless=old into Chrome capabilities')
  } catch (err) {
    log.warn(`Failed to set headless Chrome option: ${errorMessage(err)}`)
  }
}

/**
 * Selenium-specific wrapper around the core `attachBidiHandlers`. Adds the
 * adapter's logger so users see BiDi lifecycle events under the
 * `@wdio/selenium-devtools:bidi` namespace they're used to.
 */
export async function attachBidiHandlers(
  driver: unknown,
  sinks: BidiHandlerSinks
): Promise<boolean> {
  return attachBidiHandlersCore(driver, sinks, (level, message) =>
    log[level](message)
  )
}

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
        (r: NetworkRequestWithId) => r.id === id
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

type NetworkRequestWithId = { id?: string }
