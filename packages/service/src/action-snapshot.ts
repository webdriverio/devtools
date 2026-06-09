// Per-action snapshot capture — fires only in `mode: 'trace'` for commands
// in the action allow-list (see @wdio/devtools-core/action-mapping). Returns
// null on failure; snapshot errors must not break the user's test.

import {
  getBrowserAccessibilityTree,
  getElements,
  serializeMobileSnapshot,
  serializeWebSnapshot
} from '@wdio/elements'
import { SNAPSHOT_PROBE_TIMEOUT_MS, withTimeout } from '@wdio/devtools-core'
import type { ActionSnapshot } from '@wdio/devtools-shared'

type ElementsResult = Awaited<ReturnType<typeof getElements>>
const EMPTY_ELEMENTS: ElementsResult = {
  total: 0,
  showing: 0,
  hasMore: false,
  elements: []
}

function probeElements(browser: WebdriverIO.Browser): Promise<ElementsResult> {
  return withTimeout(
    getElements(browser, { inViewportOnly: true }),
    SNAPSHOT_PROBE_TIMEOUT_MS,
    EMPTY_ELEMENTS
  )
}

async function captureMobile(
  browser: WebdriverIO.Browser
): Promise<{ elements: unknown[]; snapshotText?: string }> {
  const result = await probeElements(browser)
  if (!result.tree) {
    return { elements: result.elements }
  }
  const platform = browser.isAndroid ? 'android' : 'ios'
  return {
    elements: result.elements,
    snapshotText: serializeMobileSnapshot(result.tree, { platform })
  }
}

async function captureWeb(
  browser: WebdriverIO.Browser,
  url: string | undefined,
  title: string | undefined
): Promise<{ elements: unknown[]; snapshotText?: string }> {
  const [tree, flat] = await Promise.all([
    withTimeout(
      getBrowserAccessibilityTree(browser, { inViewportOnly: true }),
      SNAPSHOT_PROBE_TIMEOUT_MS,
      []
    ),
    probeElements(browser)
  ])
  return {
    elements: flat.elements,
    snapshotText: serializeWebSnapshot(tree, { url, title })
  }
}

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
    const { elements, snapshotText } = isMobile
      ? await captureMobile(browser)
      : await captureWeb(browser, url, title)
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
