/**
 * @vitest-environment happy-dom
 *
 * The wire shape the app's DOM replay consumes. Records come from a REAL
 * MutationObserver configured with the collector's own `MUTATION_OBSERVER_CONFIG`,
 * so a config that stopped observing a record type fails here rather than
 * silently emptying the trace.
 */
import { describe, it, expect, beforeEach } from 'vitest'

import {
  MUTATION_OBSERVER_CONFIG,
  serializeMutation,
  shouldCapture
} from '../src/mutations.js'
import { assignRef, getRef } from '../src/utils.js'

const TIMESTAMP = 1_700_000_000_000

/** Mutates the page and returns the records the collector would keep. */
async function capture(mutate: () => void): Promise<TraceMutation[]> {
  const records: MutationRecord[] = []
  const observer = new MutationObserver((list) => records.push(...list))
  observer.observe(document.body, MUTATION_OBSERVER_CONFIG)
  mutate()
  // MutationObserver delivers in a microtask; happy-dom needs a macrotask turn.
  await new Promise((resolve) => setTimeout(resolve, 0))
  observer.disconnect()
  return records
    .filter(shouldCapture)
    .map((m) => serializeMutation(m, TIMESTAMP))
}

const textOf = (selector: string) =>
  document.querySelector(selector)!.firstChild as Text

describe('mutation serialization', () => {
  beforeEach(() => {
    if (!document.body) {
      document.documentElement.appendChild(document.createElement('body'))
    }
    document.body.innerHTML = ''
  })

  it('observes character data — the record type a text patch produces', () => {
    // `textNode.data = …` is how every mainstream framework patches text; an
    // observer without this flag never produces a record for it at all.
    expect(MUTATION_OBSERVER_CONFIG.characterData).toBe(true)
  })

  it('addresses a changed text node by its parent ref and child index', async () => {
    document.body.innerHTML = '<div id="flash">old</div>'
    assignRef(document.body)

    const mutations = await capture(() => {
      textOf('#flash').data = 'new'
    })

    expect(mutations).toHaveLength(1)
    const [mutation] = mutations
    expect(mutation.type).toBe('characterData')
    // The parent ELEMENT's ref, never the text node's: a Text node has no
    // attributes, so it can carry no ref of its own.
    expect(mutation.target).toBe(getRef(document.querySelector('#flash')!))
    expect(mutation.childIndex).toBe(0)
    // The mutated node's own new data — not the parent's whole text.
    expect(mutation.newTextContent).toBe('new')
  })

  it('addresses the changed child of a parent holding several', async () => {
    document.body.innerHTML =
      '<p id="notice">lead <strong>who</strong> tail</p>'
    assignRef(document.body)

    const mutations = await capture(() => {
      document.querySelector('#notice')!.childNodes[2].nodeValue = ' updated'
    })

    expect(mutations).toHaveLength(1)
    expect(mutations[0].target).toBe(getRef(document.querySelector('#notice')!))
    expect(mutations[0].childIndex).toBe(2)
    expect(mutations[0].newTextContent).toBe(' updated')
  })

  it('drops a text change under a parent that carries no ref', async () => {
    // Nothing to address it by, so the record could never be applied — keeping it
    // would only spend bytes against the mutation-stream cap.
    document.body.innerHTML = '<div id="flash">old</div>'

    const mutations = await capture(() => {
      textOf('#flash').data = 'new'
    })

    expect(mutations).toEqual([])
  })

  it('keeps addressing an element mutation by its own ref', async () => {
    document.body.innerHTML = '<div id="flash" class="success">old</div>'
    assignRef(document.body)
    const flash = document.querySelector('#flash')!

    const mutations = await capture(() => {
      flash.setAttribute('class', 'success dismissed')
    })

    expect(mutations).toHaveLength(1)
    expect(mutations[0].type).toBe('attributes')
    expect(mutations[0].target).toBe(getRef(flash))
    expect(mutations[0].attributeValue).toBe('success dismissed')
    // characterData addressing must not leak into other record types.
    expect(mutations[0].childIndex).toBeUndefined()
  })

  it('never reports the ref attribute it stamps itself', async () => {
    document.body.innerHTML = '<div id="flash">old</div>'
    assignRef(document.body)

    const mutations = await capture(() => {
      assignRef(document.createElement('span'))
      document.body.appendChild(document.createElement('span'))
    })

    expect(
      mutations.filter((m) => m.attributeName === 'data-wdio-ref')
    ).toEqual([])
  })

  it('serializes an added text node as its own data', async () => {
    // A Text node has no `outerHTML`, so serializing it as an element used to
    // throw inside parse5 and put the resulting STACK TRACE on the wire as a
    // `<div>` the replay then inserted into the page.
    document.body.innerHTML = '<div id="flash"></div>'
    assignRef(document.body)

    const mutations = await capture(() => {
      document
        .querySelector('#flash')!
        .appendChild(document.createTextNode('added text'))
    })

    const added = mutations.flatMap((m) => m.addedNodes)
    expect(added).toEqual(['added text'])
  })

  it('serializes a removed text node as null, the only mark it leaves', async () => {
    document.body.innerHTML = '<div id="flash">old</div>'
    assignRef(document.body)

    const mutations = await capture(() => {
      document.querySelector('#flash')!.textContent = 'new'
    })

    // A removed Text node carries no ref, so the replay recognises the removal
    // only by the null in its place.
    expect(mutations.flatMap((m) => m.removedNodes)).toEqual([null])
    expect(mutations.flatMap((m) => m.addedNodes)).toEqual(['new'])
  })
})
