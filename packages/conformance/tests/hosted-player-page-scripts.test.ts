// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import {
  EXPAND_COLLAPSED_ROWS,
  READ_PLAYER_STATE,
  cspViolationReporter,
  type PlayerState
} from '../hosted-player/page-scripts.js'

/** Runs a page script the way `browser.execute` runs source text: as a function body. */
function run<T>(source: string): T {
  return new Function(source)() as T
}

function host(tag: string, parent: ParentNode, html = ''): HTMLElement {
  const el = document.createElement(tag)
  el.attachShadow({ mode: 'open' }).innerHTML = html
  parent.appendChild(el)
  return el
}

function app(): ShadowRoot {
  return host('wdio-devtools', document.body).shadowRoot as ShadowRoot
}

function commandRow(parent: ParentNode, label: string, toggle?: boolean) {
  return host(
    'wdio-devtools-command-item',
    parent,
    `${
      toggle === undefined
        ? ''
        : `<button class="toggle" aria-expanded="${toggle}"></button>`
    }<button><code class="label">
      ${label}
    </code></button>`
  )
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('READ_PLAYER_STATE', () => {
  it('reads the landing screen and its error through two shadow roots', () => {
    const landing = host(
      'wdio-devtools-open-trace',
      app(),
      '<h2>WebdriverIO Trace Viewer</h2><p class="error" role="alert">Could not open x.txt: no</p>'
    )
    Object.assign(landing, { busy: false })

    const state = run<PlayerState>(READ_PLAYER_STATE)

    expect(state.landing).toEqual({
      heading: 'WebdriverIO Trace Viewer',
      busy: false,
      error: 'Could not open x.txt: no'
    })
    expect(state.alerts).toEqual(['Could not open x.txt: no'])
    expect(state.rows).toEqual([])
  })

  it('reads action rows wherever they are slotted, and filmstrip images', () => {
    const root = app()
    const workbench = host('wdio-devtools-workbench', root)
    const actions = host('wdio-devtools-actions', workbench)
    commandRow(actions.shadowRoot as ShadowRoot, 'Element.click()')
    commandRow(actions.shadowRoot as ShadowRoot, 'Expect.toBe()')
    host(
      'wdio-devtools-trace-timeline',
      workbench.shadowRoot as ShadowRoot,
      '<button><img src="data:image/png;base64,AA"></button><button><img src="/robot.png"></button>'
    )

    const state = run<PlayerState>(READ_PLAYER_STATE)

    expect(state.landing).toBe(null)
    expect(state.rows).toEqual(['Element.click()', 'Expect.toBe()'])
    expect(state.groups).toBe(0)
    expect(state.frames).toBe(1)
    expect(state.alerts).toEqual([])
    expect(Array.isArray(state.resources)).toBe(true)
  })
})

describe('EXPAND_COLLAPSED_ROWS', () => {
  it('opens collapsed groups and rows, and leaves open ones alone', async () => {
    const actions = host('wdio-devtools-actions', app())
    const tree = actions.shadowRoot as ShadowRoot
    const group = host('wdio-devtools-group-item', tree, '<button></button>')
    const openGroup = host(
      'wdio-devtools-group-item',
      tree,
      '<button></button>'
    )
    openGroup.setAttribute('expanded', '')
    const wait = commandRow(tree, 'Browser.waitForFunction()', false)
    commandRow(tree, 'Element.click()', true)
    commandRow(tree, 'Page.getTitle()')

    const clicks: string[] = []
    group.shadowRoot?.querySelector('button')?.addEventListener('click', () => {
      clicks.push('group')
      group.setAttribute('expanded', '')
    })
    openGroup.shadowRoot
      ?.querySelector('button')
      ?.addEventListener('click', () => clicks.push('open group'))
    const toggle = wait.shadowRoot?.querySelector('button.toggle')
    toggle?.addEventListener('click', () => {
      clicks.push('wait')
      toggle.setAttribute('aria-expanded', 'true')
    })

    expect(await run<Promise<number>>(EXPAND_COLLAPSED_ROWS)).toBe(2)
    expect(clicks).toEqual(['group', 'wait'])
    expect(await run<Promise<number>>(EXPAND_COLLAPSED_ROWS)).toBe(0)
  })
})

describe('cspViolationReporter', () => {
  it('logs a violation as a console error carrying the prefix', () => {
    const logged: string[] = []
    const original = console.error
    console.error = (message: string) => logged.push(message)
    try {
      const install = run<() => void>(`return ${cspViolationReporter('[csp]')}`)
      install()
      const event = new Event('securitypolicyviolation')
      Object.assign(event, {
        effectiveDirective: 'worker-src',
        blockedURI: 'blob',
        sourceFile: 'http://x/app.js',
        lineNumber: 3
      })
      document.dispatchEvent(event)
    } finally {
      console.error = original
    }
    expect(logged).toEqual([
      '[csp] worker-src blocked blob at http://x/app.js:3'
    ])
  })
})
