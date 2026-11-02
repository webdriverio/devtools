// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import type { ReactiveController, ReactiveControllerHost } from 'lit'

import { TRACE_OPEN_EVENT } from '../src/controller/constants.js'
import { TraceOpenController } from '../src/controller/trace-open.js'
import type {
  TraceOpenPhase,
  TraceOpenProgress
} from '../src/controller/trace-parse-protocol.js'

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
  load: (file: File, onPhase: TraceOpenProgress) => Promise<void>
) {
  const host = document.createElement('trace-open-stub-host') as StubHost
  const controller = new TraceOpenController(host, load)
  controller.hostConnected()
  return { host, controller }
}

const trace = new File(['zip'], 'trace.zip')

describe('TraceOpenController', () => {
  it('reports a failed open without clearing anything the app holds', async () => {
    const { controller } = setup(() => Promise.reject(new Error('bad zip')))

    await controller.open(trace)

    expect(controller.opening).toBe(false)
    expect(controller.error).toBe('Could not open trace.zip: bad zip')
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
    const load = vi.fn(() => Promise.resolve())
    const { controller } = setup(load)

    await Promise.all([controller.open(trace), controller.open(trace)])

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('opens a file announced from the UI', async () => {
    const load = vi.fn(() => Promise.resolve())
    const { host } = setup(load)

    host.dispatchEvent(new CustomEvent(TRACE_OPEN_EVENT, { detail: trace }))
    await vi.waitFor(() =>
      expect(load).toHaveBeenCalledWith(trace, expect.any(Function))
    )
  })

  it('opens a file dropped anywhere and keeps the tab from navigating to it', async () => {
    const load = vi.fn(() => Promise.resolve())
    setup(load)
    const drop = new Event('drop', { cancelable: true }) as DragEvent
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [trace] } })

    window.dispatchEvent(drop)

    expect(drop.defaultPrevented).toBe(true)
    await vi.waitFor(() =>
      expect(load).toHaveBeenCalledWith(trace, expect.any(Function))
    )
  })

  it('shows the phase the open is on and forgets it when the open ends', async () => {
    const seen: (TraceOpenPhase | undefined)[] = []
    const { host, controller } = setup(async (_file, onPhase) => {
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
