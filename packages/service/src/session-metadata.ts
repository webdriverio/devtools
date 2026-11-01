// Session metadata for the WDIO adapter, resolved at session start. Kept out of
// index.ts (already over the file cap) so the native/desktop split is
// unit-testable and the plugin only forwards its lifecycle hook.

import logger from '@wdio/logger'
import {
  SNAPSHOT_DRIVER_PROBE_TIMEOUT_MS,
  resolveViewport as coreResolveViewport,
  withTimeout
} from '@wdio/devtools-core'
import {
  deviceFromCapabilities,
  type Metadata,
  type TraceType,
  type Viewport
} from '@wdio/devtools-shared'
import type { Capabilities } from '@wdio/types'

const log = logger('@wdio/devtools-service')

/**
 * Size of the captured surface, through core's shared reader so all three JS
 * adapters answer this the same way.
 *
 * A native app's numbers are descriptive only: neither matches the screenshot's
 * own pixels (a Pixel 7 reports 1080x2219 — the window minus the navigation bar
 * — against a 1080x2400 shot, and iOS reports points), so anything sizing a
 * captured image measures the image instead. Wherever there IS a DOM it is
 * load-bearing geometry: the player sizes the replay iframe from it, and the
 * exporter falls back to 1280x720 without it.
 *
 * Bounded here rather than left to whoever awaits it. This is the one driver
 * read in the metadata path, and a session tearing down can leave it hanging
 * forever — while every trace written from then on waits for it, per slice.
 * Under `traceGranularity: 'test'` that is another ceiling's delay at EVERY
 * test-end hook instead of one degradation to the fallback viewport. The rest
 * of the metadata needs no driver, so a timed-out read still yields the
 * capabilities and device.
 */
async function resolveViewport(
  browser: WebdriverIO.Browser
): Promise<Viewport | undefined> {
  return withTimeout(
    coreResolveViewport(browser.capabilities, {
      runScript: (body) => browser.execute(body),
      getWindowSize: () => browser.getWindowSize(),
      onWarn: (message) => log.warn(message)
    }),
    SNAPSHOT_DRIVER_PROBE_TIMEOUT_MS,
    undefined
  )
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
