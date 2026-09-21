import { sessionHasDocument } from '@wdio/devtools-shared'

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

/**
 * Whether a per-action snapshot issued from inside the command hook would
 * deadlock. Appium serialises a probe behind the command it is observing, and
 * the IN-PAGE probes are the ones that hang: measured against a hybrid webview,
 * `browser.execute` and the raw-HTTP transport timed out alike and a run took
 * 2m6s where the same spec takes 34s untouched (#374).
 *
 * A NATIVE session issues none of them — `captureActionSnapshot` passes no
 * `runScript` there, only page source and a screenshot — and completes fine:
 * measured 13.6s against 5.5s with the capture skipped, no timeout. Skipping it
 * for every Appium session therefore cost each native trace its per-action data
 * to avoid a hazard native does not have, leaving a whole run sharing the one
 * snapshot taken at its end.
 *
 * So the question is a document, not a driver — and the context answers it, so
 * a hybrid app is judged by the half it is currently in.
 */
export function inPageProbesDeadlock(
  browser: WebdriverIO.Browser,
  context?: string
): boolean {
  return (
    isAppiumSession(browser) &&
    sessionHasDocument(browser.capabilities, context)
  )
}

export function mobilePlatform(
  browser: WebdriverIO.Browser
): 'android' | 'ios' | undefined {
  const b = browser as MobileBrowser
  return b.isAndroid ? 'android' : b.isIOS ? 'ios' : undefined
}
