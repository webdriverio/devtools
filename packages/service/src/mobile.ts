// Mobile-aware browser — Appium sessions expose `isMobile`, `isAndroid`,
// `isIOS` at runtime. These flags are absent from WDIO's published types
// so we narrow through a single cast here rather than repeating
// `browser as unknown as Record<string, unknown>` at every call site.

type MobileBrowser = WebdriverIO.Browser & {
  isMobile?: unknown
  isAndroid?: unknown
  isIOS?: unknown
}

export function isNativeMobile(browser: WebdriverIO.Browser): boolean {
  const b = browser as MobileBrowser
  return Boolean(b.isMobile || b.isAndroid || b.isIOS)
}

export function mobilePlatform(
  browser: WebdriverIO.Browser
): 'android' | 'ios' | undefined {
  const b = browser as MobileBrowser
  return b.isAndroid ? 'android' : b.isIOS ? 'ios' : undefined
}
