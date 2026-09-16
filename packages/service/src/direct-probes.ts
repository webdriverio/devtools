// Capture probes that go straight to the driver instead of back through WDIO.
//
// `beforeCommand` runs inside the command it is observing, so every probe it
// issues re-enters the driver mid-command. Appium serialises per session, so
// the probe enqueues behind that command and neither resolves (#374). Desktop
// chromedriver tolerates the re-entrancy, and `browser.*` carries WDIO's own
// retries and interceptors, so it stays the path wherever it works.

import {
  webdriverExecute,
  webdriverGet,
  type WebDriverAddress
} from '@wdio/devtools-core'
import { isAppiumSession } from './mobile.js'
import { resolveWebDriverAddress } from './webdriver-address.js'

/** The subset of probes `beforeCommand` issues. Mirrors the closures
 *  `captureActionSnapshot` already takes, so rerouting is a swap. */
export interface DirectProbes {
  /** `body` is a function BODY, which is what W3C `execute/sync` takes — the
   *  drain expression already is one, an element-script IIFE needs wrapping. */
  runScript: <T>(body: string) => Promise<T | undefined>
  getUrl: () => Promise<string | undefined>
  getTitle: () => Promise<string | undefined>
  takeScreenshot: () => Promise<string | undefined>
  /** The native path's page read. A native session is always an Appium one, so
   *  leaving this on `browser.*` would keep an in-hook call exactly where the
   *  serialising driver is guaranteed. */
  getPageSource: () => Promise<string | undefined>
}

const orUndefined = <T>(value: T | null): T | undefined => value ?? undefined

/**
 * Direct probes for a session whose driver serialises commands, or undefined
 * when the normal path is safe or the driver's address is not knowable.
 *
 * Gated on `isAppiumSession` rather than on being native: a native app session
 * skips these probes entirely (#372), so the one that needs this is the mobile
 * WEB session, which has a document and is driven through Appium.
 */
export function directProbes(
  browser: WebdriverIO.Browser
): DirectProbes | undefined {
  if (!isAppiumSession(browser)) {
    return undefined
  }
  const address: WebDriverAddress | undefined = resolveWebDriverAddress(browser)
  const sessionId = browser.sessionId
  if (!address || !sessionId) {
    return undefined
  }
  return {
    runScript: <T>(body: string) =>
      webdriverExecute<T>(address, sessionId, body).then(orUndefined),
    getUrl: () =>
      webdriverGet<string>(address, sessionId, 'url').then(orUndefined),
    getTitle: () =>
      webdriverGet<string>(address, sessionId, 'title').then(orUndefined),
    takeScreenshot: () =>
      webdriverGet<string>(address, sessionId, 'screenshot').then(orUndefined),
    getPageSource: () =>
      webdriverGet<string>(address, sessionId, 'source').then(orUndefined)
  }
}
