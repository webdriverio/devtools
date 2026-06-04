// Per-action snapshot capture — fires only in `mode: 'trace'` for commands
// in the action allow-list (see @wdio/devtools-core/action-mapping). Returns
// null on failure; snapshot errors must not break the user's test.

import {
  getBrowserAccessibilityTree,
  getElements,
  serializeMobileSnapshot,
  serializeWebSnapshot
} from '@wdio/elements'
import type { ActionSnapshot } from '@wdio/devtools-shared'

export async function captureActionSnapshot(
  browser: WebdriverIO.Browser,
  command: string
): Promise<ActionSnapshot | null> {
  try {
    const timestamp = Date.now()
    const isMobile = !!(browser.isAndroid || browser.isIOS)
    const [screenshot, url, title] = await Promise.all([
      browser.takeScreenshot().catch(() => undefined),
      browser.getUrl().catch(() => undefined),
      browser.getTitle().catch(() => undefined)
    ])
    let elements: unknown[] = []
    let snapshotText: string | undefined
    if (isMobile) {
      const result = await getElements(browser, { inViewportOnly: true })
      elements = result.elements
      if (result.tree) {
        const platform = browser.isAndroid ? 'android' : 'ios'
        snapshotText = serializeMobileSnapshot(result.tree, { platform })
      }
    } else {
      const [tree, flatResult] = await Promise.all([
        getBrowserAccessibilityTree(browser, { inViewportOnly: true }),
        getElements(browser, { inViewportOnly: true })
      ])
      elements = flatResult.elements
      snapshotText = serializeWebSnapshot(tree, { url, title })
    }
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
