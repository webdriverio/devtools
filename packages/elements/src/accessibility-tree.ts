/**
 * Browser accessibility tree
 * Single browser.execute() call: DOM walk → flat accessibility node list.
 *
 * The injected script lives in @wdio/devtools-core/element-scripts so it is
 * the single source of truth for both the @wdio/elements wrappers and the
 * framework-agnostic trace/snapshot pipeline.
 */

import type { AccessibilityNode } from '@wdio/devtools-core/element-types'
import { accessibilityTreeScript as _accessibilityTreeScript } from '@wdio/devtools-core/element-scripts'

export type { AccessibilityNode }

/**
 * Get browser accessibility tree via a single DOM walk.
 */
export async function getBrowserAccessibilityTree(
  browser: WebdriverIO.Browser,
  options: { inViewportOnly?: boolean } = {}
): Promise<AccessibilityNode[]> {
  const { inViewportOnly = true } = options
  const fn = new Function(
    `return (${_accessibilityTreeScript(inViewportOnly)})`
  ) as () => unknown
  return browser.execute(fn) as unknown as Promise<AccessibilityNode[]>
}
