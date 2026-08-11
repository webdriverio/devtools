import '@components/workbench/actionItems/mutation.js'
import type { MutationItem } from '@components/workbench/actionItems/mutation.js'

import type { SimplifiedVNode } from '../../../../script/types'
import { mount } from '../../support/mount.js'
import { shadow, shadowAll, text } from '../../support/queries.js'
import { mutation, documentLoaded } from '../../support/builders.js'

const TAG = 'wdio-devtools-mutation-item'
const LABEL = 'span.label'
const BADGE = '.ml-auto'
const PAGE_URL = 'https://the-internet.herokuapp.com/login'

/**
 * One added node as `serializeMutation` puts it on the wire: `parseFragment`
 * output — a typeless documentFragment wrapper around the serialized element.
 * The row only counts these, but `addedNodes` never carries markup or a bare
 * string, so a fixture that looked like `'<div></div>'` would suggest the row
 * has a shape to read that it never gets.
 */
const addedNode = (type: string): SimplifiedVNode =>
  ({ props: { children: { type, props: {} } } }) as unknown as SimplifiedVNode

describe('wdio-devtools-mutation-item', () => {
  it('renders no row without an entry', async () => {
    const el = await mount<MutationItem>(TAG, {})

    expect(shadowAll(el, 'button').length).toBe(0)
  })

  it("renders 'Document loaded' for a navigation anchor", async () => {
    const el = await mount<MutationItem>(TAG, {
      entry: documentLoaded(PAGE_URL)
    })

    expect(text(shadow(el, LABEL))).toBe('Document loaded')
    expect(shadow(el, 'icon-mdi-document')).toBeTruthy()
    expect(shadowAll(el, 'icon-mdi-family-tree').length).toBe(0)
  })

  it('renders the node count for a single added node with no url', async () => {
    const el = await mount<MutationItem>(TAG, {
      entry: mutation({ type: 'childList', addedNodes: [addedNode('div')] })
    })

    expect(text(shadow(el, LABEL))).toBe('1 node added')
    expect(shadow(el, 'icon-mdi-family-tree')).toBeTruthy()
    expect(shadowAll(el, 'icon-mdi-document').length).toBe(0)
  })

  it('renders the node count for a url mutation that added more than one node', async () => {
    const el = await mount<MutationItem>(TAG, {
      entry: documentLoaded(PAGE_URL, {
        addedNodes: [addedNode('div'), addedNode('span')]
      })
    })

    expect(text(shadow(el, LABEL))).toBe('2 nodes added')
    expect(shadowAll(el, 'icon-mdi-document').length).toBe(0)
  })

  it('pluralises the added-node label for multiple nodes', async () => {
    const el = await mount<MutationItem>(TAG, {
      entry: mutation({
        type: 'childList',
        addedNodes: [addedNode('a'), addedNode('b'), addedNode('i')]
      })
    })

    expect(text(shadow(el, LABEL))).toBe('3 nodes added')
  })

  it('renders a singular removed-node label when nothing was added', async () => {
    const el = await mount<MutationItem>(TAG, {
      entry: mutation({ type: 'childList', removedNodes: ['div-ref'] })
    })

    expect(text(shadow(el, LABEL))).toBe('1 node removed')
  })

  it("joins the added and removed counts with 'and'", async () => {
    const el = await mount<MutationItem>(TAG, {
      entry: mutation({
        type: 'childList',
        addedNodes: [addedNode('a'), addedNode('b')],
        removedNodes: ['i-ref']
      })
    })

    expect(text(shadow(el, LABEL))).toBe('2 nodes added and 1 node removed')
  })

  it('renders an empty childList label when nothing was added or removed', async () => {
    const el = await mount<MutationItem>(TAG, {
      entry: mutation({ type: 'childList' })
    })

    expect(text(shadow(el, LABEL))).toBe('')
    expect(shadow(el, 'icon-mdi-family-tree')).toBeTruthy()
  })

  it('renders the attribute name for an attributes mutation', async () => {
    const el = await mount<MutationItem>(TAG, {
      entry: mutation({ type: 'attributes', attributeName: 'aria-hidden' })
    })

    expect(text(shadow(el, LABEL))).toBe(
      'element attribute "aria-hidden" changed'
    )
    expect(shadow(el, 'icon-mdi-pencil')).toBeTruthy()
  })

  it('renders an empty attribute name when the mutation carries none', async () => {
    const el = await mount<MutationItem>(TAG, {
      entry: mutation({ type: 'attributes', attributeName: undefined })
    })

    expect(text(shadow(el, LABEL))).toBe('element attribute "" changed')
  })

  // `characterData` is the only third member of `MutationRecordType`, and no
  // recorded stream contains one — the collector's observer is configured
  // `{ attributes, childList, subtree }`, so characterData is never watched. This
  // row is therefore the defensive default rather than something a user sees.
  it('labels an unsupported mutation type as unknown', async () => {
    const el = await mount<MutationItem>(TAG, {
      entry: mutation({ type: 'characterData' })
    })

    expect(text(shadow(el, 'button'))).toBe('Unknown mutation')
    expect(shadowAll(el, LABEL).length).toBe(0)
    expect(shadowAll(el, 'span.ic').length).toBe(0)
  })

  it('renders the duration badge for the row', async () => {
    const el = await mount<MutationItem>(TAG, {
      entry: documentLoaded(PAGE_URL),
      duration: 250
    })

    expect(text(shadow(el, BADGE))).toBe('250ms')
  })

  it('omits the duration badge when no duration is known', async () => {
    const el = await mount<MutationItem>(TAG, {
      entry: documentLoaded(PAGE_URL)
    })

    expect(shadowAll(el, BADGE).length).toBe(0)
  })

  it('dispatches app-mutation-select on window when clicked', async () => {
    const entry = documentLoaded(PAGE_URL)
    const el = await mount<MutationItem>(TAG, { entry })
    const received: CustomEvent<unknown>[] = []
    const listener = (event: Event) => received.push(event as CustomEvent)

    window.addEventListener('app-mutation-select', listener)
    try {
      shadow(el, 'button')?.dispatchEvent(new MouseEvent('click'))
    } finally {
      window.removeEventListener('app-mutation-select', listener)
    }

    expect(received.length).toBe(1)
    expect(received[0]?.detail).toBe(entry)
  })

  it('dispatches app-mutation-highlight on window on mouseenter', async () => {
    const entry = mutation({ type: 'attributes', attributeName: 'class' })
    const el = await mount<MutationItem>(TAG, { entry })
    const received: CustomEvent<unknown>[] = []
    const listener = (event: Event) => received.push(event as CustomEvent)

    window.addEventListener('app-mutation-highlight', listener)
    try {
      shadow(el, 'button')?.dispatchEvent(new MouseEvent('mouseenter'))
    } finally {
      window.removeEventListener('app-mutation-highlight', listener)
    }

    expect(received.length).toBe(1)
    expect(received[0]?.detail).toBe(entry)
  })

  it('does not dispatch a select event on mouseenter alone', async () => {
    const el = await mount<MutationItem>(TAG, {
      entry: documentLoaded(PAGE_URL)
    })
    const received: CustomEvent<unknown>[] = []
    const listener = (event: Event) => received.push(event as CustomEvent)

    window.addEventListener('app-mutation-select', listener)
    try {
      shadow(el, 'button')?.dispatchEvent(new MouseEvent('mouseenter'))
    } finally {
      window.removeEventListener('app-mutation-select', listener)
    }

    expect(received.length).toBe(0)
  })
})
