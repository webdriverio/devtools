// Session metadata for the WDIO adapter, resolved at session start. Kept out of
// index.ts (already over the file cap) so the native/desktop split is
// unit-testable and the plugin only forwards its lifecycle hook.

import logger from '@wdio/logger'
import {
  deviceFromCapabilities,
  isNativeAppSession,
  type Metadata,
  type TraceType,
  type Viewport
} from '@wdio/devtools-shared'
import type { Capabilities } from '@wdio/types'

const log = logger('@wdio/devtools-service')

/**
 * Size of the captured surface. A page reports its own visual viewport; a
 * native app has no DOM to ask, so the driver's window size is the only answer
 * — measured at 1080x2219 on a Pixel 7, which is the window minus the
 * navigation bar.
 *
 * Metadata only for a native app: neither number matches the screenshot's own
 * pixels (that Pixel 7 shot is 1080x2400, and iOS reports points rather than
 * pixels), so anything sizing a captured image measures the image instead. It
 * is load-bearing wherever there IS a DOM to replay — the player sizes the
 * replay iframe from it — so a mobile BROWSER session must reach the page read
 * below, which alone carries the real scale and offsets.
 */
async function resolveViewport(
  browser: WebdriverIO.Browser
): Promise<Viewport | undefined> {
  try {
    if (isNativeAppSession(browser.capabilities)) {
      const size = await browser.getWindowSize()
      return size
        ? {
            width: size.width,
            height: size.height,
            offsetLeft: 0,
            offsetTop: 0,
            scale: 1
          }
        : undefined
    }
    return (await browser.execute(() => window.visualViewport)) || undefined
  } catch (err) {
    // A viewport is descriptive, not load-bearing — the capture is still worth
    // keeping without it, so this degrades rather than failing the session.
    log.warn(
      `Could not resolve the session viewport: ${(err as Error).message}`
    )
    return undefined
  }
}

/**
 * What the session can state about itself. A native session reports the device
 * only through its capabilities, so `deviceFromCapabilities` reads it here
 * rather than every consumer re-deriving "was this a phone?" downstream.
 *
 * `runner` is deliberately absent: `stampRunnerMetadata` has already put it on
 * the capturer, and the caller merges rather than replaces.
 */
export async function resolveSessionMetadata(
  browser: WebdriverIO.Browser,
  type: TraceType
): Promise<Partial<Metadata>> {
  const capabilities = browser.capabilities as Capabilities.W3CCapabilities
  const viewport = await resolveViewport(browser)
  const device = deviceFromCapabilities(capabilities)
  return {
    type,
    options: browser.options,
    capabilities,
    ...(viewport ? { viewport } : {}),
    ...(device ? { device } : {})
  }
}
