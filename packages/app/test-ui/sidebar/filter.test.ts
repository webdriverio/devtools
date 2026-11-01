import '@components/sidebar/filter.js'
import type { DevtoolsSidebarFilter } from '@components/sidebar/filter.js'
import { KBD } from '@/controller/keyboard.js'

import { mount } from '../support/mount.js'
import { shadow, shadowAll } from '../support/queries.js'

const TAG = 'wdio-devtools-sidebar-filter'
const FIELD = 'input[name="filter"]'
const ICON = 'icon-mdi-magnify'

function field(el: DevtoolsSidebarFilter): HTMLInputElement {
  const input = shadow<HTMLInputElement>(el, FIELD)
  if (!input) {
    throw new Error('no filter field rendered')
  }
  return input
}

/** The component reads the field on `keyup`, so a query has to arrive the way a
 *  keystroke delivers it: value first, then the key event. */
function type(el: DevtoolsSidebarFilter, query: string): void {
  const input = field(el)
  input.value = query
  input.dispatchEvent(new KeyboardEvent('keyup', { key: query.slice(-1) }))
}

/** The filter broadcasts on `window`, the way the explorer receives it. */
function captureFilter(act: () => void): CustomEvent<DevtoolsSidebarFilter>[] {
  const received: CustomEvent<DevtoolsSidebarFilter>[] = []
  const listener = (event: Event) =>
    received.push(event as CustomEvent<DevtoolsSidebarFilter>)
  window.addEventListener('app-test-filter', listener)
  try {
    act()
  } finally {
    window.removeEventListener('app-test-filter', listener)
  }
  return received
}

/** The detail is the component itself rather than a snapshot, so the query has
 *  to be read as the event lands — by assertion time the field has moved on. */
function captureQueries(act: () => void): string[] {
  const queries: string[] = []
  const listener = (event: Event) =>
    queries.push(
      (event as CustomEvent<DevtoolsSidebarFilter>).detail.filterQuery
    )
  window.addEventListener('app-test-filter', listener)
  try {
    act()
  } finally {
    window.removeEventListener('app-test-filter', listener)
  }
  return queries
}

describe('wdio-devtools-sidebar-filter', () => {
  describe('the field', () => {
    it('renders a search field naming both query forms it accepts', async () => {
      const el = await mount<DevtoolsSidebarFilter>(TAG)

      expect(field(el).placeholder).toBe('Filter (e.g. text, @tag)')
      expect(shadowAll(el, ICON)).toHaveLength(1)
    })

    it('starts with an empty query', async () => {
      const el = await mount<DevtoolsSidebarFilter>(TAG)

      expect(el.filterQuery).toBe('')
      expect(field(el).value).toBe('')
    })
  })

  describe('announcing the query', () => {
    it('broadcasts itself as the filter when a query is typed', async () => {
      const el = await mount<DevtoolsSidebarFilter>(TAG)

      const received = captureFilter(() => type(el, 'discount'))

      expect(received).toHaveLength(1)
      expect(received[0]?.detail).toBe(el)
      expect(el.filterQuery).toBe('discount')
    })

    it('broadcasts a filter that crosses shadow boundaries', async () => {
      const el = await mount<DevtoolsSidebarFilter>(TAG)

      const received = captureFilter(() => type(el, 'discount'))

      expect(received[0]?.bubbles).toBe(true)
      expect(received[0]?.composed).toBe(true)
    })

    it('broadcasts the growing query on every keystroke', async () => {
      const el = await mount<DevtoolsSidebarFilter>(TAG)

      const queries = captureQueries(() => {
        type(el, 'dis')
        type(el, 'discount')
      })

      expect(queries).toEqual(['dis', 'discount'])
    })

    it('broadcasts an empty query once the field is cleared', async () => {
      const el = await mount<DevtoolsSidebarFilter>(TAG)
      type(el, 'discount')

      const queries = captureQueries(() => type(el, ''))

      expect(queries).toEqual([''])
      expect(el.filterQuery).toBe('')
    })

    // Tag matching and case folding belong to the tree filter, so the query is
    // carried verbatim rather than parsed here.
    it('carries a tag query through with its sigil intact', async () => {
      const el = await mount<DevtoolsSidebarFilter>(TAG)

      expect(captureQueries(() => type(el, '@smoke'))).toEqual(['@smoke'])
    })

    it('carries the query through in the case it was typed', async () => {
      const el = await mount<DevtoolsSidebarFilter>(TAG)

      expect(captureQueries(() => type(el, 'DISCOUNT'))).toEqual(['DISCOUNT'])
    })
  })

  describe('the focus shortcut', () => {
    it('focuses the field when the app asks for it', async () => {
      const el = await mount<DevtoolsSidebarFilter>(TAG)

      window.dispatchEvent(new CustomEvent(KBD.focusFilter))

      expect(el.shadowRoot?.activeElement).toBe(field(el))
    })

    it('stops answering the shortcut once it leaves the page', async () => {
      const el = await mount<DevtoolsSidebarFilter>(TAG)
      const input = field(el)
      // Counted rather than read off `shadowRoot.activeElement`: `focus()` cannot
      // move that on a DETACHED host, so the removal would look successful even
      // with the listener still attached.
      let focused = 0
      input.focus = () => {
        focused += 1
      }

      // Positive control: while it is on the page the shortcut does reach here.
      window.dispatchEvent(new CustomEvent(KBD.focusFilter))
      expect(focused).toBe(1)

      el.remove()
      window.dispatchEvent(new CustomEvent(KBD.focusFilter))

      expect(focused).toBe(1)
    })
  })
})
