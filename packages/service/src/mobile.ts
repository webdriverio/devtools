// Mobile-aware browser — Appium sessions expose `isMobile`, `isAndroid`,
// `isIOS` at runtime. These flags are absent from WDIO's published types
// so we narrow through a single cast here rather than repeating
// `browser as unknown as Record<string, unknown>` at every call site.

type MobileBrowser = WebdriverIO.Browser & {
  isMobile?: unknown
  isAndroid?: unknown
  isIOS?: unknown
}

/** An Appium session, native app or mobile browser alike — the right question
 *  for anything needing WebDriver BiDi, which Appium does not serve. */
export function isAppiumSession(browser: WebdriverIO.Browser): boolean {
  const b = browser as MobileBrowser
  return Boolean(b.isMobile || b.isAndroid || b.isIOS)
}

/** A browser named anywhere in the capabilities, vendor bags included: WDIO's
 *  own `isMobile` reads `bstack:options.browserName`, so bags that carry it
 *  only there exist, and one level of scan needs no vendor list to maintain. */
function namesABrowser(capabilities: WebdriverIO.Capabilities): boolean {
  const named = (value: unknown) =>
    typeof (value as { browserName?: unknown })?.browserName === 'string' &&
    Boolean((value as { browserName: string }).browserName.trim())
  return (
    named(capabilities) || Object.values(capabilities).some((v) => named(v))
  )
}

/**
 * A session with no web document to run page script in — an Appium session
 * driving an app rather than a browser.
 *
 * Narrower than `isAppiumSession`, and not cosmetically: an Appium session
 * driving Chrome or Safari has a real page, but the flags claim it as mobile
 * anyway. WDIO's `isMobile` excludes a chrome/safari/gecko/chromium
 * automationName for exactly this reason — `isAndroid` and `isIOS` carry no
 * such exclusion, so ORing the three overrides it (measured on Appium Chrome
 * capabilities: `isMobile` false, `isAndroid` true).
 *
 * Reads the MATCHED capabilities, which is the same object WDIO derived those
 * flags from, so the two answers cannot be drawn from different sessions.
 *
 * Residual: a hybrid app switched into a webview context does have a document,
 * and no capability can say so — only `getContext()` knows that.
 */
export function isNativeAppSession(browser: WebdriverIO.Browser): boolean {
  if (!isAppiumSession(browser)) {
    return false
  }
  const capabilities = browser.capabilities
  return !capabilities || !namesABrowser(capabilities)
}

export function mobilePlatform(
  browser: WebdriverIO.Browser
): 'android' | 'ios' | undefined {
  const b = browser as MobileBrowser
  return b.isAndroid ? 'android' : b.isIOS ? 'ios' : undefined
}
