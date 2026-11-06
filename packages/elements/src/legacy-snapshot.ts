/** Legacy renderer: used when @wdio/snapshot is absent or below 10.2. */

import type { SnapshotResult } from '@wdio/devtools-core/element-types'
import {
  buildSnapshot,
  accessibilityNodesToSnapshotNodes,
  jsonElementToSnapshotNodes
} from '@wdio/devtools-core/element-snapshot'
import { getBrowserAccessibilityTree } from './accessibility-tree.js'
import { xmlToJSON } from './locators/index.js'
import { safeCall } from './safe-call.js'

/** Text tree with eN refs and an elements map of their selectors. */
export async function getSnapshot(
  browser: WebdriverIO.Browser,
  options?: { inViewportOnly?: boolean }
): Promise<SnapshotResult> {
  const { inViewportOnly = true } = options ?? {}

  if (browser.isAndroid || browser.isIOS) {
    return getMobileSnapshot(browser, inViewportOnly)
  }
  return getWebSnapshot(browser, inViewportOnly)
}

// ---------------------------------------------------------------------------
// Web
// ---------------------------------------------------------------------------

async function getWebSnapshot(
  browser: WebdriverIO.Browser,
  inViewportOnly: boolean
): Promise<SnapshotResult> {
  const [url, title, nodes] = await Promise.all([
    safeCall(() => browser.getUrl()),
    safeCall(() => browser.getTitle()),
    getBrowserAccessibilityTree(browser, { inViewportOnly })
  ])

  const header = buildWebHeader(title, url)
  const snapshotNodes = accessibilityNodesToSnapshotNodes(nodes, {
    inViewportOnly
  })
  return buildSnapshot(header, snapshotNodes)
}

function buildWebHeader(title?: string, url?: string): string {
  let h = '[Page'
  if (title) {
    h += `: ${title}`
  }
  if (url) {
    h += ` — ${url}`
  }
  h += ']'
  return h
}

// ---------------------------------------------------------------------------
// Mobile
// ---------------------------------------------------------------------------

async function getMobileSnapshot(
  browser: WebdriverIO.Browser,
  inViewportOnly: boolean
): Promise<SnapshotResult> {
  const platform: 'android' | 'ios' = browser.isAndroid ? 'android' : 'ios'

  const [viewportSize, pageSource] = await Promise.all([
    safeCall(() => browser.getWindowSize()),
    safeCall(() => browser.getPageSource())
  ])

  if (!pageSource) {
    return { text: '[No elements found]', elements: {} }
  }

  const root = xmlToJSON(pageSource)
  if (!root) {
    return { text: '[No elements found]', elements: {} }
  }

  // A zero-dimension viewport (minimized app, broken ADB connection) would
  // silently clip every element. Treat it as unavailable instead.
  const safeViewport =
    viewportSize?.width && viewportSize?.height ? viewportSize : undefined

  const deviceName = getDeviceName(browser)

  const header = buildMobileHeader(platform, deviceName, safeViewport)

  const snapshotNodes = jsonElementToSnapshotNodes(root, platform, {
    inViewportOnly,
    viewport: safeViewport,
    sourceXML: pageSource
  })

  return buildSnapshot(header, snapshotNodes)
}

function buildMobileHeader(
  platform: string,
  deviceName: string,
  viewport?: { width: number; height: number }
): string {
  let h = `[${platform}`
  if (deviceName) {
    h += ` — ${deviceName}`
  }
  if (viewport) {
    h += ` (${viewport.width}×${viewport.height})`
  }
  h += ']'
  return h
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDeviceName(browser: WebdriverIO.Browser): string {
  try {
    const caps = browser.capabilities as Record<string, unknown>
    return (
      (caps['appium:deviceName'] as string) ?? (caps.deviceName as string) ?? ''
    )
  } catch {
    return ''
  }
}
