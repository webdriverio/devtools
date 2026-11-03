/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MASKED_VALUE, type CaptureMaskConfig } from '@wdio/devtools-shared'

import type * as UtilsModule from '../src/utils.js'
import type * as CollectorModule from '../src/collector.js'

type Utils = typeof UtilsModule
type Collector = typeof CollectorModule

/** The serialized children of a vnode, as `{ props }` records. */
const childProps = (tree: unknown): Record<string, unknown>[] =>
  [
    (
      tree as {
        props: {
          children?:
            | { props: Record<string, unknown> }
            | { props: Record<string, unknown> }[]
        }
      }
    ).props.children ?? []
  ]
    .flat()
    .map((child) => child.props)

/** Fresh modules under a policy declared the way an adapter declares it, ahead of the bundle. */
async function load(config?: Partial<CaptureMaskConfig>): Promise<{
  utils: Utils
  collector: Collector
}> {
  vi.resetModules()
  vi.unstubAllGlobals()
  if (config) {
    vi.stubGlobal('__wdioCaptureMask', config)
  }
  delete window.wdioTraceCollector
  return {
    utils: await import('../src/utils.js'),
    collector: await import('../src/collector.js')
  }
}

/** The bundle's entry, which anchors the document and installs the observer and the field listeners. */
async function boot(config?: Partial<CaptureMaskConfig>) {
  await load(config)
  await import('../src/index.js')
  const collector = window.wdioTraceCollector!
  collector.getTraceData()
  return collector
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function typeInto(field: HTMLInputElement | HTMLTextAreaElement, text: string) {
  field.value = text
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  document.body.replaceChildren()
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete window.wdioTraceCollector
})

describe('a document anchor', () => {
  const FORM =
    '<input id="u" value="initial"><input id="p" type="password">' +
    '<textarea id="t">draft</textarea><input id="c" type="checkbox">' +
    '<input id="s" type="submit" value="Log in"><input id="e">'

  function typedForm(): HTMLElement {
    const form = document.createElement('form')
    form.innerHTML = FORM
    ;(form.querySelector('#u') as HTMLInputElement).value = 'tomsmith'
    ;(form.querySelector('#p') as HTMLInputElement).value = 'hunter2'
    ;(form.querySelector('#t') as HTMLTextAreaElement).value = 'notes'
    ;(form.querySelector('#c') as HTMLInputElement).checked = true
    return form
  }

  it('masks a password field by default and keeps every other value', async () => {
    const { utils } = await load()
    const props = childProps(utils.parseDocument(typedForm()))
    expect(props[0]).toMatchObject({ id: 'u', value: 'tomsmith' })
    expect(props[1]).toMatchObject({ id: 'p', value: MASKED_VALUE })
    expect(props[2]).toMatchObject({ id: 't', value: 'notes' })
    expect(props[2].children).toBe('draft')
    expect(props[3]).toMatchObject({ id: 'c', checked: '' })
    expect(props[4]).toMatchObject({ id: 's', value: 'Log in' })
    expect(props[5]).not.toHaveProperty('value')
    expect(JSON.stringify(props)).not.toContain('hunter2')
  })

  it('masks a password value attribute the page wrote', async () => {
    const { utils } = await load()
    const div = document.createElement('div')
    div.innerHTML = '<input id="p" type="password" value="prefilled">'
    expect(childProps(utils.parseDocument(div))[0].value).toBe(MASKED_VALUE)
  })

  it('keeps an empty password field empty, so masking does not fill a blank form', async () => {
    const { utils } = await load()
    const div = document.createElement('div')
    div.innerHTML = '<input id="p" type="password" value="">'
    expect(childProps(utils.parseDocument(div))[0].value).toBe('')
  })

  it('leaves a password field unmasked with maskInputs off, its live value still out of the anchor', async () => {
    const { utils } = await load({ inputs: false })
    const div = document.createElement('div')
    div.innerHTML = '<input id="p" type="password" value="prefilled">'
    ;(div.querySelector('#p') as HTMLInputElement).value = 'hunter2'
    const props = childProps(utils.parseDocument(div))
    expect(props[0].value).toBe('prefilled')
  })

  it('masks the text and value of what a mask selector matches, keeping whitespace', async () => {
    const { utils } = await load({
      inputs: false,
      selectors: ['.account', 'not a [valid selector']
    })
    const div = document.createElement('div')
    div.innerHTML =
      '<p class="account">IBAN <b>DE89 3704</b>\n</p><p>Public</p>' +
      '<div class="account"><select><option value="x">Gold</option></select></div>' +
      '<input class="account" id="n" value="1234">' +
      '<div class="account" contenteditable="true">Dear Bob</div>'
    const [account, open, wrapper, field, editor] = childProps(
      utils.parseDocument(div)
    )
    expect(JSON.stringify(account)).not.toMatch(/IBAN|DE89/)
    expect(account.children).toEqual([
      MASKED_VALUE,
      { type: 'b', props: { children: MASKED_VALUE } },
      '\n'
    ])
    expect(open.children).toBe('Public')
    expect(JSON.stringify(wrapper)).not.toMatch(/Gold|"x"/)
    expect(field.value).toBe(MASKED_VALUE)
    expect(editor.children).toBe(MASKED_VALUE)
  })

  it('masks the text-bearing attributes of what a mask selector covers, and only those', async () => {
    const { utils } = await load({ selectors: ['.account'] })
    const div = document.createElement('div')
    div.innerHTML =
      '<p class="account" title="DE89 title" aria-label="DE89 label" data-id="7">' +
      '<img alt="DE89 alt"><input placeholder="DE89 hint"></p>' +
      '<p title="Public title">Public</p>'
    const tree = utils.parseDocument(div)
    expect(JSON.stringify(tree)).not.toContain('DE89')
    const [account, open] = childProps(tree)
    expect(account).toMatchObject({
      title: MASKED_VALUE,
      'aria-label': MASKED_VALUE,
      'data-id': '7'
    })
    expect(open.title).toBe('Public title')
  })

  it('leaves an editable region and an ARIA textbox as they are without a selector', async () => {
    const { utils } = await load()
    const div = document.createElement('div')
    div.innerHTML =
      '<div contenteditable="true">Dear Bob</div><div role="textbox">note</div>'
    const [editor, textbox] = childProps(utils.parseDocument(div))
    expect([editor.children, textbox.children]).toEqual(['Dear Bob', 'note'])
  })
})

describe('the live stream', () => {
  async function bootWithField(
    type: string,
    config?: Partial<CaptureMaskConfig>
  ) {
    const collector = await boot(config)
    const field = document.createElement('input')
    field.type = type
    document.body.append(field)
    await flush()
    collector.getTraceData()
    return { collector, field }
  }

  const valueMutations = (collector: Window['wdioTraceCollector']) =>
    collector!
      .getTraceData()
      .mutations.filter((m) => m.attributeName === 'value')
      .map((m) => m.attributeValue)

  it('masks what is typed into a password field, keystroke by keystroke', async () => {
    const { collector, field } = await bootWithField('password')
    for (const text of ['h', 'hu', 'hun']) {
      typeInto(field, text)
    }
    expect(valueMutations(collector)).toEqual([
      MASKED_VALUE,
      MASKED_VALUE,
      MASKED_VALUE
    ])
  })

  it('records what is typed into a text field as it is', async () => {
    const { collector, field } = await bootWithField('text')
    typeInto(field, 'tomsmith')
    expect(valueMutations(collector)).toEqual(['tomsmith'])
  })

  it('keeps masking a password field a show-password toggle turned into text', async () => {
    const { collector, field } = await bootWithField('password')
    typeInto(field, 'hunter2')
    field.type = 'text'
    typeInto(field, 'hunter22')
    expect(valueMutations(collector)).toEqual([MASKED_VALUE, MASKED_VALUE])
  })

  it('masks a value attribute the page writes back on a password field', async () => {
    const { collector, field } = await bootWithField('password')
    field.setAttribute('value', 'hunter2')
    await flush()
    const mutation = collector
      .getTraceData()
      .mutations.find((m) => m.type === 'attributes')
    expect(mutation?.attributeValue).toBe(MASKED_VALUE)
  })

  it('records a password field as typed with maskInputs off', async () => {
    const { collector, field } = await bootWithField('password', {
      inputs: false
    })
    typeInto(field, 'hunter2')
    expect(valueMutations(collector)).toEqual(['hunter2'])
  })

  it('masks a field under a mask selector with maskInputs off', async () => {
    const collector = await boot({ inputs: false, selectors: ['#card'] })
    const field = document.createElement('input')
    field.id = 'card'
    document.body.append(field)
    await flush()
    collector.getTraceData()
    typeInto(field, '4111 1111')
    expect(valueMutations(collector)).toEqual([MASKED_VALUE])
  })

  it('masks text added or changed under a mask selector', async () => {
    const collector = await boot({ selectors: ['#balance'] })
    const balance = document.createElement('div')
    balance.id = 'balance'
    balance.textContent = 'initial'
    document.body.append(balance)
    await flush()
    collector.getTraceData()

    balance.append(document.createElement('span'))
    balance.firstChild!.nodeValue = '1,000 EUR'
    balance.lastChild!.textContent = '2,000 EUR'
    await flush()
    const { mutations } = collector.getTraceData()
    expect(mutations.length).toBeGreaterThan(0)
    expect(JSON.stringify(mutations)).not.toContain('EUR')
  })
})

describe('attribute changes under a mask selector', () => {
  it('masks a text-bearing attribute and keeps any other', async () => {
    const collector = await boot({ selectors: ['#card'] })
    const card = document.createElement('div')
    card.id = 'card'
    document.body.append(card)
    await flush()
    collector.getTraceData()

    card.setAttribute('title', 'DE89 3704')
    card.setAttribute('data-state', 'open')
    await flush()
    const attributes = collector
      .getTraceData()
      .mutations.filter((m) => m.type === 'attributes')
      .map((m) => [m.attributeName, m.attributeValue])
    expect(attributes).toEqual([
      ['title', MASKED_VALUE],
      ['data-state', 'open']
    ])
  })
})

describe('the element scripts', () => {
  it('read the mask selector from the collector', async () => {
    const collector = await boot({ selectors: ['.secret', '#pin'] })
    expect(collector.maskSelector()).toBe('.secret, #pin')
  })

  it('have none without a selector', async () => {
    const collector = await boot()
    expect(collector.maskSelector()).toBeNull()
  })
})
