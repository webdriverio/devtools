// Per-action snapshot capture for Nightwatch — fires only in `mode: 'trace'`
// for commands in ACTION_MAP. Wraps NightwatchBrowser in a minimal
// WebdriverIO.Browser-shaped shim so @wdio/elements can run its in-page
// scripts. Returns null on failure; capture errors must not break the test.

import {
  getBrowserAccessibilityTree,
  getInteractableBrowserElements,
  serializeWebSnapshot
} from '@wdio/elements'
import type { ActionSnapshot } from '@wdio/devtools-shared'
import type { NightwatchBrowser } from './types.js'

interface BrowserWithUrl extends NightwatchBrowser {
  getCurrentUrl?: () => Promise<string>
  getTitle?: () => Promise<string>
}

function shimAsWdioBrowser(browser: NightwatchBrowser): unknown {
  return {
    capabilities: browser.capabilities ?? {},
    isAndroid: false,
    isIOS: false,
    execute: (script: unknown, ...args: unknown[]) =>
      browser.execute(
        script as string,
        args.length === 1 && Array.isArray(args[0])
          ? (args[0] as unknown[])
          : args
      )
  }
}

export async function captureActionSnapshot(
  browser: NightwatchBrowser,
  command: string,
  takeScreenshot?: () => Promise<string | null | undefined>
): Promise<ActionSnapshot | null> {
  try {
    const timestamp = Date.now()
    const b = browser as BrowserWithUrl
    const browserLike = shimAsWdioBrowser(browser) as WebdriverIO.Browser
    const [shot, url, title, tree, elements] = await Promise.all([
      takeScreenshot?.().catch(() => null) ?? Promise.resolve(null),
      b.getCurrentUrl?.().catch(() => undefined) ?? Promise.resolve(undefined),
      b.getTitle?.().catch(() => undefined) ?? Promise.resolve(undefined),
      getBrowserAccessibilityTree(browserLike, { inViewportOnly: true }).catch(
        () => []
      ),
      getInteractableBrowserElements(browserLike, {
        inViewportOnly: true
      }).catch(() => [])
    ])
    const snapshotText = serializeWebSnapshot(tree, { url, title })
    return {
      timestamp,
      command,
      url,
      title,
      screenshot: shot ?? undefined,
      elements,
      snapshotText
    }
  } catch {
    return null
  }
}
