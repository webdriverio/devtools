import { getInteractableBrowserElements } from './browser-elements.js'
import { getMobileVisibleElementsWithTree } from './mobile-elements.js'
import type { JSONElement } from './locators/types.js'

export type VisibleElementsResult = {
  total: number
  showing: number
  hasMore: boolean
  elements: unknown[]
  /** Raw JSON element tree — only present for mobile (android/ios) sessions */
  tree?: JSONElement
}

export async function getElements(
  browser: WebdriverIO.Browser,
  params: {
    inViewportOnly?: boolean
    includeContainers?: boolean
    includeBounds?: boolean
    limit?: number
    offset?: number
  }
): Promise<VisibleElementsResult> {
  const {
    inViewportOnly = true,
    includeContainers = false,
    includeBounds = false,
    limit = 0,
    offset = 0
  } = params

  let elements: { isInViewport?: boolean }[]
  let tree: JSONElement | undefined

  if (browser.isAndroid || browser.isIOS) {
    const platform = browser.isAndroid ? 'android' : 'ios'
    const result = await getMobileVisibleElementsWithTree(browser, platform, {
      includeContainers,
      includeBounds
    })
    elements = result.elements
    tree = result.tree ?? undefined
  } else {
    elements = await getInteractableBrowserElements(browser, { includeBounds })
  }

  if (inViewportOnly) {
    elements = elements.filter((el) => el.isInViewport !== false)
  }

  const total = elements.length

  if (offset > 0) {
    elements = elements.slice(offset)
  }
  if (limit > 0) {
    elements = elements.slice(0, limit)
  }

  return {
    total,
    showing: elements.length,
    hasMore: offset + elements.length < total,
    elements,
    ...(tree !== undefined ? { tree } : {})
  }
}
