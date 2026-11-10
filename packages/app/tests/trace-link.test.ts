// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import type { CommandLog } from '@wdio/devtools-shared'
import type { ReactiveController, ReactiveControllerHost } from 'lit'

import {
  DOCK_TAB_CHANGE_EVENT,
  DOCK_TABS_READY_EVENT,
  OPEN_DOCK_TAB_EVENT
} from '../src/controller/constants.js'
import { PLAYER_SEEK_ACTION_EVENT } from '../src/components/browser/trace-timeline-constants.js'
import { TraceLinkController } from '../src/controller/trace-link.js'
import {
  clearTraceAddress,
  currentTraceLink,
  traceParamFrom,
  updateTraceLink
} from '../src/utils/trace-link.js'

const START = window.location.href

afterEach(() => {
  history.replaceState(null, '', START)
})

const command = (callId?: string): CommandLog => ({
  command: 'click',
  args: [],
  timestamp: 1,
  ...(callId ? { callId } : {})
})

describe('updateTraceLink', () => {
  it('merges into the hash and keeps the query, without a history entry', () => {
    history.replaceState(null, '', '/?trace=%2Fa.zip#tab=console')
    const entries = history.length

    updateTraceLink({ action: 'call@4' })

    expect(window.location.search).toBe('?trace=%2Fa.zip')
    expect(window.location.hash).toBe('#action=call@4&tab=console')
    expect(currentTraceLink()).toEqual({ action: 'call@4', tab: 'console' })
    expect(history.length).toBe(entries)
  })

  it('removes a key set to undefined', () => {
    history.replaceState(null, '', '/#action=call@4&tab=console')

    updateTraceLink({ action: undefined })

    expect(window.location.hash).toBe('#tab=console')
  })
})

describe('clearTraceAddress', () => {
  it('drops the hash, `trace` and the unencoded URL’s own parameters after it', () => {
    history.replaceState(
      null,
      '',
      '/?view=x&trace=https://ci.example.com/t.zip?sig=a&exp=1#action=call@2'
    )

    clearTraceAddress()

    expect(window.location.search).toBe('?view=x')
    expect(window.location.hash).toBe('')
  })
})

describe('traceParamFrom', () => {
  it('keeps an unencoded signed URL whole, its own & parameters included', () => {
    expect(
      traceParamFrom(
        '?trace=https://bucket.example.com/t.zip?X-Amz-Signature=ab%2Bc&X-Amz-Date=1'
      )
    ).toBe(
      'https://bucket.example.com/t.zip?X-Amz-Signature=ab%2Bc&X-Amz-Date=1'
    )
  })

  it('decodes the percent-encoded form once', () => {
    expect(
      traceParamFrom(
        '?trace=https%3A%2F%2Fci.example.com%2Ft.zip%3Fsig%3Dab%252B%26exp%3D1'
      )
    ).toBe('https://ci.example.com/t.zip?sig=ab%2B&exp=1')
    expect(traceParamFrom('?trace=%2Ffixtures%2Ft.zip')).toBe('/fixtures/t.zip')
  })

  it('ends an encoded value at the first raw &, the page’s own parameter', () => {
    expect(
      traceParamFrom(
        '?trace=https%3A%2F%2Fci.example.com%2Ft.zip%3Fa%3D1%26b%3D2&utm_source=x'
      )
    ).toBe('https://ci.example.com/t.zip?a=1&b=2')
  })

  it('takes a relative path as written', () => {
    expect(traceParamFrom('?trace=/t.zip')).toBe('/t.zip')
  })

  it('reads nothing without the parameter', () => {
    expect(traceParamFrom('')).toBeNull()
    expect(traceParamFrom('?retrace=x')).toBeNull()
  })
})

class StubHost implements ReactiveControllerHost {
  readonly controllers: ReactiveController[] = []
  addController(controller: ReactiveController) {
    this.controllers.push(controller)
  }
  removeController() {}
  requestUpdate() {}
  get updateComplete() {
    return Promise.resolve(true)
  }
}

function show(entry: CommandLog) {
  window.dispatchEvent(
    new CustomEvent<CommandEventProps>('show-command', {
      detail: { command: entry, elapsedTime: 0 }
    })
  )
}

/** Every request the controller makes of the timeline and the dock. */
function requests() {
  const seeks: string[] = []
  const tabs: unknown[] = []
  const onSeek = (event: CustomEvent<string>) => seeks.push(event.detail)
  const onTab = (event: CustomEvent) => tabs.push(event.detail)
  window.addEventListener(PLAYER_SEEK_ACTION_EVENT, onSeek)
  window.addEventListener(OPEN_DOCK_TAB_EVENT, onTab)
  return {
    seeks,
    tabs,
    stop: () => {
      window.removeEventListener(PLAYER_SEEK_ACTION_EVENT, onSeek)
      window.removeEventListener(OPEN_DOCK_TAB_EVENT, onTab)
    }
  }
}

function setup(options: { isPlayer?: boolean; isRun?: boolean } = {}) {
  const controller = new TraceLinkController(new StubHost(), {
    isPlayer: () => options.isPlayer ?? true,
    isRun: () => options.isRun ?? false
  })
  controller.hostConnected()
  return controller
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve))
const dockReady = () =>
  window.dispatchEvent(new CustomEvent(DOCK_TABS_READY_EVENT))

describe('TraceLinkController', () => {
  it('writes the shown action into the address in player mode', () => {
    const controller = setup()

    show(command('call@7'))

    controller.hostDisconnected()
    expect(window.location.hash).toBe('#action=call@7')
  })

  it('leaves the live dashboard’s address alone', () => {
    const controller = setup({ isPlayer: false })

    show(command('call@7'))

    controller.hostDisconnected()
    expect(window.location.hash).toBe('')
  })

  it('writes nothing for a row without a callId', () => {
    const controller = setup()

    show(command())

    controller.hostDisconnected()
    expect(window.location.hash).toBe('')
  })

  it('writes a foreign callId holding a slash and a space so it reads back', () => {
    const controller = setup()

    show(command('hook/before all'))

    controller.hostDisconnected()
    expect(currentTraceLink().action).toBe('hook/before all')
  })

  it('writes the dock tab opened, by its lower-case name', () => {
    const controller = setup()

    window.dispatchEvent(
      new CustomEvent<string>(DOCK_TAB_CHANGE_EVENT, { detail: 'Network' })
    )

    controller.hostDisconnected()
    expect(window.location.hash).toBe('#tab=network')
  })

  it('applies the page’s link once, after the first action is announced', async () => {
    history.replaceState(null, '', '/#action=call@2&tab=network')
    const seen = requests()
    const controller = setup()

    show(command('call@1'))
    expect(seen.seeks).toEqual([])
    await flush()
    dockReady()
    show(command('call@2'))
    show(command('call@5'))
    dockReady()
    await flush()

    controller.hostDisconnected()
    seen.stop()
    expect(seen.seeks).toEqual(['call@2'])
    expect(seen.tabs).toEqual([{ label: 'network', linked: true }])
    expect(window.location.hash).toBe('#action=call@5&tab=network')
  })

  it('opens a second trace on its own first action and default tab, with the first one’s address gone', async () => {
    history.replaceState(null, '', '/?trace=%2Fa.zip#action=call@2&tab=network')
    const seen = requests()
    const controller = setup()
    show(command('call@1'))
    await flush()
    show(command('call@4'))

    controller.forget()
    show(command('call@1'))
    dockReady()
    await flush()

    controller.hostDisconnected()
    seen.stop()
    expect(seen.seeks).toEqual(['call@2'])
    expect(seen.tabs).toEqual([])
    expect(window.location.search).toBe('')
    expect(window.location.hash).toBe('#action=call@1')
  })

  it('keeps a link that came with the page for the first trace the viewer opens', async () => {
    history.replaceState(null, '', '/#action=call@3')
    const seen = requests()
    const controller = setup()

    controller.forget()
    show(command('call@1'))
    await flush()

    controller.hostDisconnected()
    seen.stop()
    expect(seen.seeks).toEqual(['call@3'])
  })

  it('neither writes nor applies an action while several traces are open as a run', async () => {
    history.replaceState(null, '', '/#action=call@3&tab=errors')
    const seen = requests()
    const controller = setup({ isRun: true })

    show(command('call@1'))
    await flush()
    show(command('call@4'))
    dockReady()

    controller.hostDisconnected()
    seen.stop()
    expect(seen.seeks).toEqual([])
    expect(seen.tabs).toEqual([{ label: 'errors', linked: true }])
    expect(window.location.hash).toBe('#tab=errors')
  })

  it('re-opens only the tab when only the tab in the address changed', () => {
    history.replaceState(null, '', '/#action=call@6&tab=network')
    const seen = requests()
    const controller = setup()

    window.dispatchEvent(
      new HashChangeEvent('hashchange', {
        oldURL: new URL('/#action=call@6&tab=console', START).href,
        newURL: window.location.href
      })
    )

    controller.hostDisconnected()
    seen.stop()
    expect(seen.seeks).toEqual([])
    expect(seen.tabs).toEqual([{ label: 'network', linked: true }])
  })

  it('ignores a hash change in the live dashboard', () => {
    history.replaceState(null, '', '/#action=call@6&tab=network')
    const seen = requests()
    const controller = setup({ isPlayer: false })

    window.dispatchEvent(new Event('hashchange'))

    controller.hostDisconnected()
    seen.stop()
    expect(seen.seeks).toEqual([])
    expect(seen.tabs).toEqual([])
  })

  it('follows a link the viewer puts in the address', () => {
    const seen = requests()
    const controller = setup()

    history.replaceState(null, '', '/#action=call@6&tab=console')
    window.dispatchEvent(new Event('hashchange'))

    controller.hostDisconnected()
    seen.stop()
    expect(seen.seeks).toEqual(['call@6'])
    expect(seen.tabs).toEqual([{ label: 'console', linked: true }])
  })
})
