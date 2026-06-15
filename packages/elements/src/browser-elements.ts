/**
 * Browser element detection
 * Single browser.execute() call: querySelectorAll → flat interactable element list.
 *
 * The injected script lives in @wdio/devtools-core/element-scripts so it is
 * the single source of truth for both the @wdio/elements wrappers and the
 * framework-agnostic trace/snapshot pipeline.
 */

import type {
  BrowserElementInfo,
  GetBrowserElementsOptions
} from '@wdio/devtools-core/element-types'
import { elementsScript as _elementsScript } from '@wdio/devtools-core/element-scripts'

export type { BrowserElementInfo, GetBrowserElementsOptions }

/**
 * Get interactable browser elements via querySelectorAll.
 *
 * The script body lives in core but is converted back to a function for
 * WDIO's `browser.execute(fn, args)` serialization. Passing a raw string
 * to execute() invokes a different code path that may not preserve scope.
 */
export async function getInteractableBrowserElements(
  browser: WebdriverIO.Browser,
  options: GetBrowserElementsOptions = {}
): Promise<BrowserElementInfo[]> {
  const { includeBounds = false, inViewportOnly = true } = options
  const fn = new Function(
    `return (${_elementsScript(includeBounds, inViewportOnly)})`
  ) as () => unknown
  return browser.execute(fn) as unknown as Promise<BrowserElementInfo[]>
}
