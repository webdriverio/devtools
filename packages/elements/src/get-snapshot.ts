/**
 * Unified getSnapshot() — single call for web and mobile.
 *
 * Auto-detects platform, fetches the accessibility tree (web) or page source
 * (mobile), converts to a flat SnapshotNode[], and renders a text tree with
 * e1, e2, … virtual IDs baked in plus an elements map for direct selector
 * resolution.
 */

import type { SnapshotResult } from '@wdio/devtools-core/element-types'
import {
  buildSnapshot,
  accessibilityNodesToSnapshotNodes,
  jsonElementToSnapshotNodes
} from '@wdio/devtools-core/element-snapshot'
import { getBrowserAccessibilityTree } from './accessibility-tree.js'
import { xmlToJSON } from './locators/index.js'

export interface GetSnapshotOptions {
  /** Only include elements whose bounds intersect the viewport (default true). */
  inViewportOnly?: boolean
}

/**
 * Take a snapshot of the current page/app state.
 *
 * Returns a text tree with eN virtual IDs for every interactive element
 * and an elements map so consumers can resolve e1, e2, … to real selectors
 * without any post-processing.
 */
export async function getSnapshot(
  browser: WebdriverIO.Browser,
  options?: GetSnapshotOptions
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

  const deviceName = getDeviceName(browser)

  const header = buildMobileHeader(platform, deviceName, viewportSize)

  const snapshotNodes = jsonElementToSnapshotNodes(root, platform, {
    inViewportOnly,
    viewport: viewportSize ?? undefined,
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

async function safeCall<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch {
    return undefined
  }
}

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
