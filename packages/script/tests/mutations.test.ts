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
  dropCoveredRecords,
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
  return dropCoveredRecords(records)
    .filter(shouldCapture)
    .map((m) => serializeMutation(m, TIMESTAMP))
}

const textOf = (selector: string) =>
  document.querySelector(selector)!.firstChild as Text

beforeEach(() => {
  if (!document.body) {
    document.documentElement.appendChild(document.createElement('body'))
  }
  document.body.innerHTML = ''
})

describe('mutation serialization', () => {
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

  /**
   * A removed attribute and one present with an empty value are different page
   * states that both read back as falsy, and only the wire tells the replay
   * which happened: a boolean attribute's PRESENCE is its state, so `''` means
   * set (`<input disabled>` serializes to exactly that) and the removal has to
   * arrive carrying no value at all. Asserted on the JSON the trace actually
   * writes, since that is where an `undefined` field becomes an absent one.
   */
  describe('a removed attribute versus one present with an empty value', () => {
    const onWire = (m: TraceMutation) =>
      JSON.parse(JSON.stringify(m)) as Record<string, unknown>

    it('carries no value for an attribute the page removed', async () => {
      document.body.innerHTML = '<input id="field" disabled>'
      assignRef(document.body)
      const field = document.querySelector('#field')!

      const mutations = await capture(() => {
        field.removeAttribute('disabled')
      })

      expect(mutations).toHaveLength(1)
      expect(mutations[0].attributeName).toBe('disabled')
      // Coerced to `''` this record says the field is still disabled.
      expect(mutations[0].attributeValue).toBeUndefined()
      expect('attributeValue' in onWire(mutations[0])).toBe(false)
    })

    it('carries the empty value of an attribute the page set to it', async () => {
      document.body.innerHTML = '<input id="field">'
      assignRef(document.body)
      const field = document.querySelector('#field')!

      const mutations = await capture(() => {
        field.setAttribute('readonly', '')
      })

      expect(mutations).toHaveLength(1)
      expect(mutations[0].attributeValue).toBe('')
      // Present and empty — indistinguishable from the removal above unless the
      // field survives the trip as its own key.
      expect(onWire(mutations[0]).attributeValue).toBe('')
    })

    it('keeps carrying the empty value of an emptied non-boolean attribute', async () => {
      // The case the removal signal must not swallow: `class=""` is a real value
      // the replay writes, and it reaches the wire the same way `disabled` does.
      document.body.innerHTML = '<div id="flash" class="success"></div>'
      assignRef(document.body)
      const flash = document.querySelector('#flash')!

      const mutations = await capture(() => {
        flash.setAttribute('class', '')
      })

      expect(mutations[0].attributeValue).toBe('')
    })
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

describe('records covered by another record in the same batch', () => {
  it('keeps only the outermost insertion when a parent and its child are added together', async () => {
    assignRef(document.body)

    const mutations = await capture(() => {
      const parent = document.createElement('div')
      parent.id = 'parent'
      document.body.appendChild(parent)
      // Same batch, and `parent` is already in the document — so this insertion
      // gets its own record while also landing inside `parent`'s serialization.
      const child = document.createElement('input')
      child.id = 'child'
      parent.appendChild(child)
    })

    expect(mutations).toHaveLength(1)
    expect(mutations[0].target).toBe(getRef(document.body))
    expect(JSON.stringify(mutations[0].addedNodes)).toContain('"id":"child"')
  })

  it('drops a whole nested chain, however deep', async () => {
    assignRef(document.body)

    const mutations = await capture(() => {
      const a = document.createElement('div')
      document.body.appendChild(a)
      const b = document.createElement('div')
      a.appendChild(b)
      const c = document.createElement('form')
      b.appendChild(c)
      c.appendChild(document.createElement('input'))
    })

    expect(mutations).toHaveLength(1)
    const serialized = JSON.stringify(mutations[0].addedNodes)
    expect(serialized).toContain('form')
    expect(serialized).toContain('input')
  })

  it('drops an attribute change made inside a subtree the batch added', async () => {
    assignRef(document.body)

    const mutations = await capture(() => {
      const el = document.createElement('div')
      document.body.appendChild(el)
      // Already reflected: the payload is serialized after this runs.
      el.setAttribute('class', 'ready')
    })

    expect(mutations).toHaveLength(1)
    expect(mutations[0].type).toBe('childList')
    expect(JSON.stringify(mutations[0].addedNodes)).toContain('"class":"ready"')
  })

  it('keeps an insertion into an element the batch did NOT add', async () => {
    document.body.innerHTML = '<div id="host"></div>'
    assignRef(document.body)
    const host = document.querySelector('#host')!
    assignRef(host)

    const mutations = await capture(() => {
      host.appendChild(document.createElement('span'))
    })

    // The host predates the batch, so nothing else carries this insertion.
    expect(mutations).toHaveLength(1)
    expect(mutations[0].target).toBe(getRef(host))
  })

  it('keeps a later batch adding into a subtree an earlier batch created', async () => {
    assignRef(document.body)

    await capture(() => {
      const el = document.createElement('div')
      el.id = 'grown'
      document.body.appendChild(el)
    })
    // A separate batch: the first payload was serialized before this existed,
    // so this insertion is the only record of it.
    const later = await capture(() => {
      document.querySelector('#grown')!.appendChild(document.createElement('p'))
    })

    expect(later).toHaveLength(1)
    expect(later[0].target).toBe(getRef(document.querySelector('#grown')!))
  })
})
