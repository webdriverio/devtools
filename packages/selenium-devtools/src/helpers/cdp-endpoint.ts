import type { CapGet } from './driverMetadata.js'

function vendorDebuggerAddress(vendorOptions: unknown): string | undefined {
  if (!vendorOptions || typeof vendorOptions !== 'object') {
    return undefined
  }
  const address = (vendorOptions as { debuggerAddress?: unknown })
    .debuggerAddress
  return typeof address === 'string' && address ? address : undefined
}

/**
 * Why `createCDPConnection` cannot reach a CDP endpoint for this session, or
 * `undefined` when it can. Mirrors how selenium-webdriver resolves the
 * endpoint (`se:cdp`, then the Chromium vendor options' `debuggerAddress`,
 * or the `SELENIUM_REMOTE_URL` grid route), since without one it throws
 * `debuggerAddress.match is not a function` rather than declining.
 */
export function cdpUnavailableReason(capGet: CapGet): string | undefined {
  // selenium-webdriver refuses CDP for Firefox outright, and Firefox never served Page.startScreencast.
  if (capGet('browserName') === 'firefox') {
    return 'CDP is not supported for Firefox'
  }
  if (process.env.SELENIUM_REMOTE_URL) {
    return undefined
  }
  const seCdp = capGet('se:cdp')
  if (typeof seCdp === 'string' && seCdp) {
    return undefined
  }
  const vendorOptions = capGet('goog:chromeOptions') || capGet('ms:edgeOptions')
  if (vendorDebuggerAddress(vendorOptions)) {
    return undefined
  }
  return 'no CDP endpoint in the session capabilities'
}
