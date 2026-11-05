// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import type { ReactiveController, ReactiveControllerHost } from 'lit'

import { TRACE_OPEN_EVENT } from '../src/controller/constants.js'
import {
  TraceOpenController,
  type TraceOpenTargets
} from '../src/controller/trace-open.js'
import type { TraceOpenPhase } from '../src/controller/trace-parse-protocol.js'
import type { TraceSource } from '../src/utils/trace-sources.js'

class StubHost extends HTMLElement implements ReactiveControllerHost {
  readonly controllers: ReactiveController[] = []
  updates = 0

  addController(controller: ReactiveController) {
    this.controllers.push(controller)
  }

  removeController() {}

  requestUpdate() {
    this.updates++
  }

  get updateComplete(): Promise<boolean> {
    return Promise.resolve(true)
  }
}
customElements.define('trace-open-stub-host', StubHost)

function setup(
  one: TraceOpenTargets['one'],
  many: TraceOpenTargets['many'] = () => {}
) {
  const host = document.createElement('trace-open-stub-host') as StubHost
  const controller = new TraceOpenController(host, { one, many })
  controller.hostConnected()
  return { host, controller }
}

const file = new File(['zip'], 'trace.zip')
const source = (path: string, bytes: Blob = file): TraceSource => ({
  path,
  read: () => Promise.resolve(bytes)
})
const trace = [source('run/login/trace.zip')]

describe('TraceOpenController', () => {
  it('reports a failed open without clearing anything the app holds', async () => {
    const { controller } = setup(() => Promise.reject(new Error('bad zip')))

    await controller.open(trace)

    expect(controller.opening).toBe(false)
    expect(controller.error).toBe('Could not open trace.zip: bad zip')
  })

  it('reports a file that could not be read as a failed open', async () => {
    const { controller } = setup(() => Promise.resolve())

    await controller.open([
      { path: 'a.zip', read: () => Promise.reject(new Error('gone')) }
    ])

    expect(controller.error).toBe('Could not open a.zip: gone')
  })

  it('clears an earlier error when the next open starts and succeeds', async () => {
    let fail = true
    const { controller } = setup(() =>
      fail ? Promise.reject(new Error('bad zip')) : Promise.resolve()
    )
    await controller.open(trace)
    fail = false

    await controller.open(trace)

    expect(controller.error).toBeUndefined()
  })

  it('opens one file at a time', async () => {
    const one = vi.fn(() => Promise.resolve())
    const { controller } = setup(one)

    await Promise.all([controller.open(trace), controller.open(trace)])

    expect(one).toHaveBeenCalledTimes(1)
  })

  it('plays a single trace, whatever folder it came from', async () => {
    const one = vi.fn(() => Promise.resolve())
    const many = vi.fn()
    const { controller } = setup(one, many)

    await controller.open(trace)

    expect(one).toHaveBeenCalledWith(file, expect.any(Function))
    expect(many).not.toHaveBeenCalled()
  })

  it('lists several traces instead of playing one', async () => {
    const one = vi.fn(() => Promise.resolve())
    const many = vi.fn()
    const { controller } = setup(one, many)
    const run = [source('a/trace.zip'), source('b/trace.zip')]

    await controller.open(run)

    expect(many).toHaveBeenCalledWith(run)
    expect(one).not.toHaveBeenCalled()
  })

  it('says so when what was opened held no trace', async () => {
    const one = vi.fn(() => Promise.resolve())
    const { controller } = setup(one)

    await controller.open([])

    expect(controller.error).toBe('No trace .zip found in what was opened')
    expect(one).not.toHaveBeenCalled()
  })

  it('opens traces announced from the UI', async () => {
    const one = vi.fn(() => Promise.resolve())
    const { host } = setup(one)

    host.dispatchEvent(new CustomEvent(TRACE_OPEN_EVENT, { detail: trace }))
    await vi.waitFor(() =>
      expect(one).toHaveBeenCalledWith(file, expect.any(Function))
    )
  })

  it('opens a file dropped anywhere and keeps the tab from navigating to it', async () => {
    const one = vi.fn(() => Promise.resolve())
    setup(one)
    const drop = new Event('drop', { cancelable: true }) as DragEvent
    Object.defineProperty(drop, 'dataTransfer', {
      value: { items: [], files: [file] }
    })

    window.dispatchEvent(drop)

    expect(drop.defaultPrevented).toBe(true)
    await vi.waitFor(() =>
      expect(one).toHaveBeenCalledWith(file, expect.any(Function))
    )
  })

  it('reports a drop whose folders could not be walked', async () => {
    const { controller } = setup(() => Promise.resolve())

    await controller.openDrop(Promise.reject(new Error('denied')))

    expect(controller.error).toBe('Could not read what was dropped: denied')
  })

  it('shows the phase the open is on and forgets it when the open ends', async () => {
    const seen: (TraceOpenPhase | undefined)[] = []
    const { host, controller } = setup(async (_bytes, onPhase) => {
      onPhase('reading')
      seen.push(controller.phase)
      onPhase('building')
      seen.push(controller.phase)
    })
    const updatesBefore = host.updates

    await controller.open(trace)

    expect(seen).toEqual(['reading', 'building'])
    expect(host.updates - updatesBefore).toBe(4)
    expect(controller.phase).toBeUndefined()
  })

  it('dismisses the error', async () => {
    const { controller } = setup(() => Promise.reject(new Error('bad zip')))
    await controller.open(trace)

    controller.dismissError()

    expect(controller.error).toBeUndefined()
  })
})

describe('TraceOpenController.openUrl', () => {
  const PAGE = new URL('https://trace.webdriver.io/')
  const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9])

  it('downloads the zip and hands it to the player, phase by phase', async () => {
    const fetchZip = vi.fn<typeof fetch>(async () => new Response(ZIP))
    vi.stubGlobal('fetch', fetchZip)
    const phases: (TraceOpenPhase | undefined)[] = []
    let opened: Blob | undefined
    const { controller } = setup(async (bytes) => {
      phases.push(controller.phase)
      opened = bytes
    })

    await controller.openUrl(
      'https://ci.example.com/a/trace.zip?sig=s3cret',
      PAGE
    )

    vi.unstubAllGlobals()
    expect(phases).toEqual(['downloading'])
    expect(new Uint8Array(await opened!.arrayBuffer())).toEqual(ZIP)
    expect(String(fetchZip.mock.calls[0][0])).toBe(
      'https://ci.example.com/a/trace.zip?sig=s3cret'
    )
    expect(controller.error).toBeUndefined()
  })

  it('refuses a URL that is not https without fetching it', async () => {
    const fetchZip = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchZip)
    const one = vi.fn(() => Promise.resolve())
    const { controller } = setup(one)

    await controller.openUrl('javascript:alert(1)', PAGE)

    vi.unstubAllGlobals()
    expect(fetchZip).not.toHaveBeenCalled()
    expect(one).not.toHaveBeenCalled()
    expect(controller.error).toBe(
      'Could not open the trace URL: Only https URLs can be opened, and this one is javascript:'
    )
  })

  it('names a failed download by host and path, never by its query', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response('', { status: 403 }))
    )
    const { controller } = setup(() => Promise.resolve())

    await controller.openUrl(
      'https://ci.example.com/a/trace.zip?sig=s3cret',
      PAGE
    )

    vi.unstubAllGlobals()
    expect(controller.error).toMatch(
      /^Could not open trace\.zip: ci\.example\.com answered 403;/
    )
    expect(controller.error).not.toContain('s3cret')
    expect(controller.opening).toBe(false)
  })

  it('reports a stalled download and still opens the next file picked', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => new Promise<Response>(() => {}))
    )
    const one = vi.fn(() => Promise.resolve())
    const { controller } = setup(one)

    const stalled = controller.openUrl('https://ci.example.com/t.zip', PAGE)
    await vi.advanceTimersByTimeAsync(30_000)
    await stalled
    vi.useRealTimers()
    vi.unstubAllGlobals()

    expect(controller.error).toBe(
      'Could not open t.zip: ci.example.com sent nothing for 30 s, so the download was stopped'
    )
    expect(controller.opening).toBe(false)
    await controller.open(trace)
    expect(one).toHaveBeenCalledTimes(1)
  })

  it('tells the app when the viewer opens a trace by hand, never for `?trace=`', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response(ZIP))
    )
    const host = document.createElement('trace-open-stub-host') as StubHost
    const onUserOpen = vi.fn()
    const controller = new TraceOpenController(
      host,
      { one: () => Promise.resolve(), many: () => {} },
      onUserOpen
    )

    await controller.openUrl('https://ci.example.com/t.zip', PAGE)
    expect(onUserOpen).not.toHaveBeenCalled()
    await controller.open(trace)

    vi.unstubAllGlobals()
    expect(onUserOpen).toHaveBeenCalledTimes(1)
  })

  it('leaves the shown trace’s address alone when a hand-opened file fails', async () => {
    const host = document.createElement('trace-open-stub-host') as StubHost
    const onUserOpen = vi.fn()
    const controller = new TraceOpenController(
      host,
      { one: () => Promise.reject(new Error('bad zip')), many: () => {} },
      onUserOpen
    )

    await controller.open(trace)

    expect(controller.error).toBe('Could not open trace.zip: bad zip')
    expect(onUserOpen).not.toHaveBeenCalled()
  })

  it('refuses an empty `?trace=` without fetching anything', async () => {
    const fetchZip = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchZip)
    const { controller } = setup(() => Promise.resolve())

    await controller.openUrl('  ', PAGE)

    vi.unstubAllGlobals()
    expect(fetchZip).not.toHaveBeenCalled()
    expect(controller.error).toBe(
      'Could not open the trace URL: The trace parameter is empty'
    )
  })

  it('downloads an unencoded signed URL whole when `trace` is the last parameter', async () => {
    const fetchZip = vi.fn<typeof fetch>(async () => new Response(ZIP))
    vi.stubGlobal('fetch', fetchZip)
    const before = window.location.href
    history.replaceState(
      null,
      '',
      '/?trace=https://ci.example.com/t.zip?sig=a%2Bb&exp=9'
    )
    const one = vi.fn(() => Promise.resolve())

    setup(one)
    await vi.waitFor(() => expect(one).toHaveBeenCalledTimes(1))

    history.replaceState(null, '', before)
    vi.unstubAllGlobals()
    expect(String(fetchZip.mock.calls[0][0])).toBe(
      'https://ci.example.com/t.zip?sig=a%2Bb&exp=9'
    )
  })

  it('opens the zip the page address names when it connects', async () => {
    const fetchZip = vi.fn<typeof fetch>(async () => new Response(ZIP))
    vi.stubGlobal('fetch', fetchZip)
    const before = window.location.href
    history.replaceState(null, '', '/?trace=%2Ffixtures%2Ftrace.zip')
    const one = vi.fn(() => Promise.resolve())

    setup(one)
    await vi.waitFor(() => expect(one).toHaveBeenCalledTimes(1))

    history.replaceState(null, '', before)
    vi.unstubAllGlobals()
    expect(String(fetchZip.mock.calls[0][0])).toBe(
      new URL('/fixtures/trace.zip', window.location.href).href
    )
  })
})
