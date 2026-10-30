// Run in the player's page through `browser.execute`, as source text rather than functions: a transpiled
// function can reference helpers (esbuild's `__name`) that exist only in the Node process.

/** Every element of the document, shadow roots included, as `nodes`. */
const COLLECT_NODES = `
  const nodes = []
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      nodes.push(el)
      if (el.shadowRoot) walk(el.shadowRoot)
    }
  }
  walk(document)
  const text = (el) => (el ? (el.textContent || '').trim() : '')
  const inShadow = (el, selector) => (el && el.shadowRoot ? el.shadowRoot.querySelector(selector) : null)
`

export interface PlayerState {
  landing: { heading: string; busy: boolean; error: string } | null
  /** Text of every `role="alert"`: the landing error and the open-failure banner. */
  alerts: string[]
  /** The label of every rendered action row. */
  rows: string[]
  /** Rendered group rows; a trace whose groups start collapsed shows these and no action row. */
  groups: number
  /** Filmstrip thumbnails carrying an image. */
  frames: number
  /** URLs in the page's Resource Timing buffer. */
  resources: string[]
}

/** Returns a `PlayerState`. */
export const READ_PLAYER_STATE = `${COLLECT_NODES}
  const byTag = (tag) => nodes.filter((el) => el.localName === tag)
  const landing = byTag('wdio-devtools-open-trace')[0]
  return {
    landing: landing
      ? {
          heading: text(inShadow(landing, 'h2')),
          busy: Boolean(landing.busy),
          error: text(inShadow(landing, '.error'))
        }
      : null,
    alerts: nodes.filter((el) => el.getAttribute('role') === 'alert').map(text),
    rows: byTag('wdio-devtools-command-item').map((el) => text(inShadow(el, 'code.label'))),
    groups: byTag('wdio-devtools-group-item').length,
    frames: byTag('wdio-devtools-trace-timeline').reduce(
      (count, el) => count + (el.shadowRoot ? el.shadowRoot.querySelectorAll('img[src^="data:image/"]').length : 0),
      0
    ),
    resources: performance.getEntriesByType('resource').map((entry) => entry.name)
  }
`

/** Opens every collapsed group and every collapsed row that issued others, then resolves how many it opened once they rendered. */
export const EXPAND_COLLAPSED_ROWS = `${COLLECT_NODES}
  let opened = 0
  for (const el of nodes) {
    const toggle =
      el.localName === 'wdio-devtools-group-item' && !el.hasAttribute('expanded')
        ? inShadow(el, 'button')
        : el.localName === 'wdio-devtools-command-item'
          ? inShadow(el, 'button.toggle[aria-expanded="false"]')
          : null
    if (toggle) {
      toggle.click()
      opened += 1
    }
  }
  return new Promise((resolve) => setTimeout(() => resolve(opened), 50))
`

/** Reports each CSP violation as a console error: BiDi's `log.entryAdded` carries console calls and exceptions, not the browser's own CSP messages. */
export function cspViolationReporter(prefix: string): string {
  return `() => {
  document.addEventListener('securitypolicyviolation', (event) => {
    console.error(
      ${JSON.stringify(prefix)} + ' ' + event.effectiveDirective + ' blocked ' +
        (event.blockedURI || 'inline') + ' at ' + (event.sourceFile || document.URL) + ':' + event.lineNumber
    )
  })
}`
}
