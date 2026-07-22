// Draws the "element overlay" — a labeled, click-to-copy box over each locator
// the test interacted with — INSIDE the replayed iframe's document, so the
// boxes inherit the iframe's scale transform (no manual coordinate math). Kept
// out of snapshot.ts so that file stays focused on capture/replay.

const OVERLAY_CLASS = '__wdio-el-overlay__'

export interface OverlayHandlers {
  /** Click a box — copy its locator + jump to the A11y row (selector + name). */
  onPick: (selector: string, label: string) => void
  /** Hover a box — reveal the matching a11y-tree row (by selector, else by the
   *  element's accessible name for locators the serializer captured a different
   *  way, e.g. the test's `button[type=submit]` vs the tree's `button*=Login`). */
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

/**
 * Outline each selector that resolves in the replayed iframe, labelled with the
 * locator and copying it on click. Selectors that querySelector can't parse
 * (WDIO-style, e.g. `button*=Login`) are skipped rather than throwing.
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
    let el: Element | null = null
    try {
      el = docEl.querySelector(selector)
    } catch {
      continue // non-CSS (WDIO) locator — can't resolve in the DOM
    }
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
