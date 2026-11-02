/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MASKED_VALUE, type CaptureMaskConfig } from '@wdio/devtools-shared'

import type * as UtilsModule from '../src/utils.js'
import type * as CollectorModule from '../src/collector.js'

type Utils = typeof UtilsModule
type Collector = typeof CollectorModule

/** The serialized children of a vnode, as `{ props }` records. */
const childProps = (tree: unknown): Record<string, unknown>[] =>
  (
    (tree as { props: { children: { props: Record<string, unknown> }[] } })
      .props.children ?? []
  ).map((child) => child.props)

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

  it('masks every typed value by default, keeping labels and choices', async () => {
    const { utils } = await load()
    const props = childProps(utils.parseDocument(typedForm()))
    expect(props[0]).toMatchObject({ id: 'u', value: MASKED_VALUE })
    expect(props[1]).toMatchObject({ id: 'p', value: MASKED_VALUE })
    expect(props[2]).toMatchObject({ id: 't', value: MASKED_VALUE })
    expect(props[2].children).toBe(MASKED_VALUE)
    expect(props[3]).toMatchObject({ id: 'c', checked: '' })
    expect(props[4]).toMatchObject({ id: 's', value: 'Log in' })
    expect(props[5]).not.toHaveProperty('value')
    expect(JSON.stringify(props)).not.toMatch(/tomsmith|hunter2|notes|draft/)
  })

  it('keeps an empty field empty, so masking does not fill a blank form', async () => {
    const { utils } = await load()
    const div = document.createElement('div')
    div.innerHTML = '<input id="u" value=""><textarea id="t"></textarea>'
    const props = childProps(utils.parseDocument(div))
    expect(props[0].value).toBe('')
    expect(props[1]).not.toHaveProperty('children')
  })

  it('carries typed values verbatim with masking off, a password still excepted', async () => {
    const { utils } = await load({ inputs: false })
    const props = childProps(utils.parseDocument(typedForm()))
    expect(props[0]).toMatchObject({ id: 'u', value: 'tomsmith' })
    expect(props[1]).not.toHaveProperty('value')
    expect(props[2]).toMatchObject({ id: 't', value: 'notes' })
    expect(props[2].children).toBe('draft')
  })

  it('leaves an untouched field’s attributes as they are with masking off', async () => {
    const { utils } = await load({ inputs: false })
    const div = document.createElement('div')
    div.innerHTML = '<input id="u" value="initial"><input id="e">'
    const props = childProps(utils.parseDocument(div))
    expect(props[0]).toMatchObject({ value: 'initial' })
    expect(props[1]).not.toHaveProperty('value')
  })

  it('masks the text and value of what a mask selector matches, keeping whitespace', async () => {
    const { utils } = await load({
      inputs: false,
      selectors: ['.account', 'not a [valid selector']
    })
    const div = document.createElement('div')
    div.innerHTML =
      '<p class="account">IBAN <b>DE89 3704</b>\n</p><p>Public</p>' +
      '<div class="account"><select><option value="x">Gold</option></select></div>'
    const [account, open, wrapper] = childProps(utils.parseDocument(div))
    expect(JSON.stringify(account)).not.toMatch(/IBAN|DE89/)
    expect(account.children).toEqual([
      MASKED_VALUE,
      { type: 'b', props: { children: MASKED_VALUE } },
      '\n'
    ])
    expect(open.children).toBe('Public')
    expect(JSON.stringify(wrapper)).not.toMatch(/Gold|"x"/)
  })
})

describe('the live stream', () => {
  it('masks what is typed into a field, keystroke by keystroke', async () => {
    const collector = await boot()
    const field = document.createElement('input')
    document.body.append(field)
    await flush()
    collector.getTraceData()

    for (const text of ['t', 'to', 'tom']) {
      typeInto(field, text)
    }
    const values = collector
      .getTraceData()
      .mutations.filter((m) => m.attributeName === 'value')
      .map((m) => m.attributeValue)
    expect(values).toEqual([MASKED_VALUE, MASKED_VALUE, MASKED_VALUE])
  })

  it('masks a value attribute the page writes back on every keystroke', async () => {
    const collector = await boot()
    const field = document.createElement('input')
    document.body.append(field)
    await flush()
    collector.getTraceData()

    field.setAttribute('value', 'tomsmith')
    await flush()
    const mutation = collector
      .getTraceData()
      .mutations.find((m) => m.type === 'attributes')
    expect(mutation?.attributeValue).toBe(MASKED_VALUE)
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

  it('records the typed value as it is with masking off', async () => {
    const collector = await boot({ inputs: false })
    const field = document.createElement('input')
    document.body.append(field)
    await flush()
    collector.getTraceData()

    typeInto(field, 'tomsmith')
    const mutation = collector
      .getTraceData()
      .mutations.find((m) => m.attributeName === 'value')
    expect(mutation?.attributeValue).toBe('tomsmith')
  })

  it('scrubs what was typed out of what the page logs and sends', async () => {
    const realFetch = window.fetch
    window.fetch = vi.fn().mockResolvedValue(
      new Response('{"echo":"S3cret pass"}', {
        headers: { 'content-type': 'application/json' }
      })
    )
    try {
      const collector = await boot()
      const field = document.createElement('input')
      field.type = 'password'
      document.body.append(field)
      await flush()
      typeInto(field, 'S3cret pass')
      collector.getTraceData()

      console.log('login with', 'S3cret pass', { raw: 'S3cret pass' })
      await window.fetch('https://app.test/login', {
        method: 'POST',
        body: 'user=tom&password=S3cret+pass'
      })
      await flush()
      const { consoleLogs, networkRequests } = collector.getTraceData()
      expect(consoleLogs[consoleLogs.length - 1].args.slice(0, 2)).toEqual([
        'login with',
        MASKED_VALUE
      ])
      const login = networkRequests.find((r) => r.url.endsWith('/login'))!
      expect(login.requestBody).toBe(`user=tom&password=${MASKED_VALUE}`)
      expect(login.responseBody).toBe(`{"echo":"${MASKED_VALUE}"}`)
    } finally {
      window.fetch = realFetch
    }
  })
})

describe('what the page itself put in a field', () => {
  it('is masked in the DOM but never scrubbed out of other text', async () => {
    const realFetch = window.fetch
    window.fetch = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', {
        headers: { 'content-type': 'application/json' }
      })
    )
    try {
      document.body.innerHTML =
        '<input type="hidden" name="remember" value="true">' +
        '<input id="u" value="prefilled-user">'
      const collector = await boot()
      collector.captureCurrentDom()
      const { mutations } = collector.getTraceData()
      expect(JSON.stringify(mutations)).not.toMatch(/prefilled-user|"true"/)

      await window.fetch('https://app.test/state', {
        method: 'POST',
        body: '{"remember":true,"user":"prefilled-user"}'
      })
      await flush()
      const { networkRequests } = collector.getTraceData()
      const state = networkRequests.find((r) => r.url.endsWith('/state'))!
      expect(state.requestBody).toBe(
        '{"remember":true,"user":"prefilled-user"}'
      )
      expect(state.responseBody).toBe('{"ok":true}')
    } finally {
      window.fetch = realFetch
    }
  })
})

describe('typing surfaces other than form fields', () => {
  it('masks an editable region and an ARIA textbox in the anchor', async () => {
    const { utils } = await load()
    const div = document.createElement('div')
    div.innerHTML =
      '<div contenteditable="true"><p>Dear <b>Bob</b></p></div>' +
      '<div role="textbox">my note</div><div contenteditable="false">shown</div>'
    const [editor, textbox, readonly] = childProps(utils.parseDocument(div))
    expect(JSON.stringify([editor, textbox])).not.toMatch(/Dear|Bob|my note/)
    expect(textbox.children).toBe(MASKED_VALUE)
    expect(readonly.children).toBe('shown')
  })

  it('masks what is typed into an editable region as it changes', async () => {
    const collector = await boot()
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    editor.append(document.createElement('p'))
    editor.firstElementChild!.textContent = 'x'
    document.body.append(editor)
    await flush()
    collector.getTraceData()

    editor.firstElementChild!.firstChild!.nodeValue = 'Dear Bob'
    editor.append(document.createTextNode(' P.S. secret plan'))
    await flush()
    const { mutations } = collector.getTraceData()
    expect(mutations.length).toBeGreaterThan(0)
    expect(JSON.stringify(mutations)).not.toMatch(/Dear Bob|secret plan/)
  })

  it('leaves an editable region as it is with masking off', async () => {
    const { utils } = await load({ inputs: false })
    const div = document.createElement('div')
    div.innerHTML =
      '<div contenteditable="true">Dear Bob</div><div role="textbox">note</div>'
    const [editor, textbox] = childProps(utils.parseDocument(div))
    expect([editor.children, textbox.children]).toEqual(['Dear Bob', 'note'])
  })
})

describe('the element scripts', () => {
  it('read the mask selector from the collector', async () => {
    const collector = await boot({ selectors: ['.secret', '#pin'] })
    expect(collector.maskSelector()).toBe('.secret, #pin')
  })

  it('read where typed text lives from the collector, and nothing with masking off', async () => {
    expect((await boot()).typingSurfaceSelector()).toContain('contenteditable')
    expect((await boot({ inputs: false })).typingSurfaceSelector()).toBeNull()
  })

  it('have none without a selector', async () => {
    const collector = await boot()
    expect(collector.maskSelector()).toBeNull()
  })
})
