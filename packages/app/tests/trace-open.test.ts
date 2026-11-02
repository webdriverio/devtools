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
