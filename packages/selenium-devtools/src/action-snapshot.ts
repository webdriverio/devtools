// Per-action snapshot capture for Selenium — fires only in `mode: 'trace'`
// for commands in ACTION_MAP. Wraps the SeleniumDriverLike in a minimal
// WebdriverIO.Browser-shaped shim so @wdio/elements can run its in-page
// scripts via driver.executeScript. Returns null on failure; capture errors
// must not break the user's test.

import {
  getBrowserAccessibilityTree,
  getInteractableBrowserElements,
  serializeWebSnapshot
} from '@wdio/elements'
import type { ActionSnapshot } from '@wdio/devtools-shared'
import type { SeleniumDriverLike } from './types.js'

interface DriverWithUrl extends SeleniumDriverLike {
  getCurrentUrl?: () => Promise<string>
  getTitle?: () => Promise<string>
}

function shimAsWdioBrowser(driver: SeleniumDriverLike): unknown {
  return {
    capabilities: {},
    isAndroid: false,
    isIOS: false,
    execute: (script: unknown, ...args: unknown[]) =>
      driver.executeScript(script as string, ...args)
  }
}

export async function captureActionSnapshot(
  driver: SeleniumDriverLike,
  command: string
): Promise<ActionSnapshot | null> {
  try {
    const timestamp = Date.now()
    const d = driver as DriverWithUrl
    const browserLike = shimAsWdioBrowser(driver) as WebdriverIO.Browser
    const [screenshot, url, title, tree, elements] = await Promise.all([
      d.takeScreenshot?.().catch(() => undefined) ?? Promise.resolve(undefined),
      d.getCurrentUrl?.().catch(() => undefined) ?? Promise.resolve(undefined),
      d.getTitle?.().catch(() => undefined) ?? Promise.resolve(undefined),
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
      screenshot,
      elements,
      snapshotText
    }
  } catch {
    return null
  }
}
