// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import {
  EXPAND_COLLAPSED_ROWS,
  READ_PLAYER_STATE,
  READ_TRACE_POSITION,
  clickRow,
  cspViolationReporter,
  type PlayerState,
  type TracePosition
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

  it('reads action rows wherever they are slotted, and filmstrip images, inline or read from the zip', () => {
    const root = app()
    const workbench = host('wdio-devtools-workbench', root)
    const actions = host('wdio-devtools-actions', workbench)
    commandRow(actions.shadowRoot as ShadowRoot, 'Element.click()')
    commandRow(actions.shadowRoot as ShadowRoot, 'Expect.toBe()')
    host(
      'wdio-devtools-trace-timeline',
      workbench.shadowRoot as ShadowRoot,
      '<button><img src="data:image/png;base64,AA"></button><button><img src="blob:http://localhost/1"></button><button><img src="/robot.png"></button>'
    )

    const state = run<PlayerState>(READ_PLAYER_STATE)

    expect(state.landing).toBe(null)
    expect(state.rows).toEqual(['Element.click()', 'Expect.toBe()'])
    expect(state.groups).toBe(0)
    expect(state.frames).toBe(2)
    expect(state.alerts).toEqual([])
    expect(Array.isArray(state.resources)).toBe(true)
  })
})

describe('READ_TRACE_POSITION', () => {
  it('reads the active row, the dock’s open tab and the hash', () => {
    const root = app()
    const actions = host('wdio-devtools-actions', root)
    commandRow(actions.shadowRoot as ShadowRoot, 'Page.navigate("x")')
    commandRow(
      actions.shadowRoot as ShadowRoot,
      'Element.click()'
    ).setAttribute('active', '')
    const panes = host('wdio-devtools-tabs', root)
    panes.setAttribute('cacheId', 'activeActionsTab')
    panes.innerHTML =
      '<wdio-devtools-tab label="Actions" active></wdio-devtools-tab>'
    const dock = host('wdio-devtools-tabs', root)
    dock.setAttribute('cacheId', 'activeWorkbenchTab')
    dock.innerHTML =
      '<wdio-devtools-tab label="Source"></wdio-devtools-tab><wdio-devtools-tab label="Network" active></wdio-devtools-tab>'
    const page = location.href
    history.replaceState(null, '', '#action=call@4')

    const position = run<TracePosition>(READ_TRACE_POSITION)

    history.replaceState(null, '', page)
    expect(position).toEqual({
      activeRow: 'Element.click()',
      dockTab: 'Network',
      hash: '#action=call@4'
    })
  })

  it('reads nulls before a trace is open', () => {
    expect(run<TracePosition>(READ_TRACE_POSITION)).toMatchObject({
      activeRow: null,
      dockTab: null
    })
  })
})

describe('clickRow', () => {
  it('clicks the label of the row it names, and says when there is none', () => {
    const actions = host('wdio-devtools-actions', app())
    const row = commandRow(actions.shadowRoot as ShadowRoot, 'Element.click()')
    let clicked = 0
    row.shadowRoot
      ?.querySelector('code.label')
      ?.addEventListener('click', () => clicked++)

    expect(run<boolean>(clickRow('Element.click()'))).toBe(true)
    expect(run<boolean>(clickRow('Page.getTitle()'))).toBe(false)
    expect(clicked).toBe(1)
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
