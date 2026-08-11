// Draws the "element overlay" — a labeled, click-to-copy box over each locator
// the test interacted with — INSIDE the replayed iframe's document, so the
// boxes inherit the iframe's scale transform (no manual coordinate math). Kept
// out of snapshot.ts so that file stays focused on capture/replay.

import { isXPathLocator } from '@wdio/devtools-shared'

const OVERLAY_CLASS = '__wdio-el-overlay__'

export interface OverlayHandlers {
  /** Click a box — copy its locator + jump to the A11y row (selector + name). */
  onPick: (selector: string, label: string) => void
  /** Hover a box — reveal the matching a11y-tree row (by selector, else by the
   *  element's accessible name for locators the serializer captured a different
   *  way, e.g. the test's `button[type=submit]` vs the tree's
   *  `//button[contains(., "Login")]`). */
  onHover?: (selector: string, label: string) => void
  onLeave?: () => void
}

export function clearElementOverlay(
  iframe: HTMLIFrameElement | null | undefined
): void {
  iframe?.contentDocument
    ?.querySelectorAll(`.${OVERLAY_CLASS}`)
    .forEach((node) => node.remove())
}

/** Cheap accessible-name approximation for cross-referencing the a11y tree —
 *  the visible label a screen reader would announce, not the raw value. */
function elementLabel(el: Element): string {
  const aria = el.getAttribute('aria-label')?.trim()
  if (aria) {
    return aria
  }
  const text = el.textContent?.trim()
  if (text) {
    return text
  }
  return el.getAttribute('placeholder')?.trim() ?? ''
}

/** `XPathResult.FIRST_ORDERED_NODE_TYPE`, read as a literal so the resolver
 *  doesn't depend on the constant being reachable from this realm. */
const XPATH_FIRST_ORDERED_NODE = 9

/** First node an XPath locator matches, as the frameworks' own `By.xpath` /
 *  `useXpath` do. Element-only: an expression selecting an attribute or text
 *  node has nothing to draw a box over. */
function resolveXPath(doc: Document, expression: string): Element | null {
  try {
    const node = doc.evaluate(
      expression,
      doc,
      null,
      XPATH_FIRST_ORDERED_NODE,
      null
    ).singleNodeValue
    // nodeType, not `instanceof Element`: the replayed nodes belong to the
    // iframe's realm, where the parent document's constructors don't match.
    return node?.nodeType === 1 ? (node as Element) : null
  } catch {
    // Malformed expression, or a document with no XPath engine.
    return null
  }
}

/** Resolve a test locator in the replayed document: XPath first, then native
 *  CSS, then the WebdriverIO text-selectors querySelector can't parse
 *  (`tag=Exact`, `tag*=Contains`, and their tag-less forms) — those still arrive
 *  from hand-written WDIO tests and from traces recorded before the capture
 *  became portable. Returns the deepest text match so a container that merely
 *  encloses the text isn't boxed over the real element. Returns null when
 *  nothing matches (locator absent on this page). */
export function resolveTestSelector(
  doc: Document,
  selector: string
): Element | null {
  if (isXPathLocator(selector)) {
    return resolveXPath(doc, selector)
  }
  try {
    const css = doc.querySelector(selector)
    if (css) {
      return css
    }
  } catch {
    // Not valid CSS — try the WDIO text-selector forms below.
  }
  // WDIO text-selector: `tag=Exact` / `tag*=Contains` (tag optional). Parsed by
  // hand — a single regex for it trips the redos linter. querySelector already
  // handled every real CSS form above (incl. `[attr*=v]`), so anything with a
  // non-tag head here is junk and bails.
  const eq = selector.indexOf('=')
  if (eq < 0) {
    return null
  }
  const text = selector.slice(eq + 1).trim()
  let head = selector.slice(0, eq)
  const exact = !head.endsWith('*')
  if (!exact) {
    head = head.slice(0, -1)
  }
  if (!text || (head && !/^[a-zA-Z][\w-]*$/.test(head))) {
    return null
  }
  const hits = Array.from(doc.querySelectorAll(head || '*')).filter((el) => {
    const elText = (el.textContent || '').trim()
    return exact ? elText === text : elText.includes(text)
  })
  return (
    hits.find(
      (el) => !hits.some((other) => other !== el && el.contains(other))
    ) ??
    hits[hits.length - 1] ??
    null
  )
}

/**
 * Outline each locator the test used that resolves on the replayed page,
 * labelled with the locator and copying it on click. A locator absent from the
 * current page (e.g. the element a click navigated away from) draws no box.
 */
export function drawElementOverlay(
  iframe: HTMLIFrameElement | null | undefined,
  selectors: string[],
  handlers: OverlayHandlers
): void {
  const docEl = iframe?.contentDocument
  if (!docEl?.body) {
    return
  }
  clearElementOverlay(iframe)
  // Force a synchronous layout flush before measuring. #sizeSnapshotToViewport
  // strips + restores the iframe's inline size in the same frame that draws the
  // overlay, so the content reflow to full width is still pending — reading
  // rects now would capture the transient narrow-breakpoint layout (boxes end up
  // low + oversized). Reading offsetHeight settles layout first.
  void docEl.documentElement.offsetHeight
  const scrollY = iframe?.contentWindow?.scrollY || 0
  const scrollX = iframe?.contentWindow?.scrollX || 0
  for (const selector of selectors) {
    const el = resolveTestSelector(docEl, selector)
    if (!el) {
      continue
    }
    const name = elementLabel(el)
    const rect = el.getBoundingClientRect()
    const box = docEl.createElement('div')
    box.className = OVERLAY_CLASS
    box.setAttribute(
      'style',
      `position:absolute;box-sizing:border-box;top:${scrollY + rect.top}px;left:${scrollX + rect.left}px;width:${rect.width}px;height:${rect.height}px;outline:1.5px solid #38bdf8;background:rgba(56,189,248,0.12);z-index:9999;cursor:pointer;`
    )
    box.title = `Copy locator: ${selector}`
    const label = docEl.createElement('div')
    label.textContent = selector
    label.setAttribute(
      'style',
      'position:absolute;top:-15px;left:-1px;font:10px/1.4 ui-monospace,monospace;background:#38bdf8;color:#06222e;padding:0 4px;white-space:nowrap;border-radius:3px 3px 0 0;'
    )
    box.appendChild(label)
    box.addEventListener('click', (e) => {
      e.stopPropagation()
      handlers.onPick(selector, name)
    })
    box.addEventListener('mouseenter', () => handlers.onHover?.(selector, name))
    box.addEventListener('mouseleave', () => handlers.onLeave?.())
    docEl.body.appendChild(box)
  }
}
