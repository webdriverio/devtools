// Draws the "element overlay" — a labeled, click-to-copy box over each locator
// the test interacted with — INSIDE the replayed iframe's document, so the
// boxes inherit the iframe's scale transform (no manual coordinate math). Kept
// out of snapshot.ts so that file stays focused on capture/replay.

const OVERLAY_CLASS = '__wdio-el-overlay__'

export function clearElementOverlay(
  iframe: HTMLIFrameElement | null | undefined
): void {
  iframe?.contentDocument
    ?.querySelectorAll(`.${OVERLAY_CLASS}`)
    .forEach((node) => node.remove())
}

/**
 * Outline each selector that resolves in the replayed iframe, labelled with the
 * locator and copying it on click. Selectors that querySelector can't parse
 * (WDIO-style, e.g. `button*=Login`) are skipped rather than throwing.
 */
export function drawElementOverlay(
  iframe: HTMLIFrameElement | null | undefined,
  selectors: string[],
  onPick: (selector: string) => void
): void {
  const docEl = iframe?.contentDocument
  if (!docEl?.body) {
    return
  }
  clearElementOverlay(iframe)
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
      onPick(selector)
    })
    docEl.body.appendChild(box)
  }
}
