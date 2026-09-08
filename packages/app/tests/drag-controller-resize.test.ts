// @vitest-environment happy-dom
//
// The player pane took its height from a pixel number resolved once, from
// whatever window was open at construction, and nothing recomputed it: measured
// at 124px in a 1280x720 window and still 124px at 2560x1440, so a trace
// rendered into a 13px-wide box on a 2560px screen.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { minWorkbenchHeight } from '../src/controller/constants.js'
import { DragController, Direction } from '../src/utils/DragController.js'

/** Position as a number, off the `flex-basis: Npx` the host renders. */
const positionOf = (drag: DragController): number =>
  parseFloat(drag.getPosition().split(':')[1])

/**
 * The controller only needs a ReactiveControllerHost to count updates and a
 * shadow root to look for its handle in. No handle exists here, so the pointer
 * tracker never attaches — position handling is what this covers.
 */
function fakeHost() {
  const host = {
    updates: 0,
    // A real ReactiveControllerHost that is already connected calls this the
    // moment a controller is added, which is what registers its listener.
    addController: (controller: { hostConnected?: () => void }) =>
      controller.hostConnected?.(),
    removeController: () => {},
    requestUpdate() {
      host.updates++
    },
    updateComplete: Promise.resolve(true),
    shadowRoot: { querySelector: () => null }
  }
  return host as unknown as ConstructorParameters<typeof DragController>[0] & {
    updates: number
  }
}

const setWindowHeight = (height: number) => {
  Object.defineProperty(window, 'innerHeight', {
    value: height,
    configurable: true,
    writable: true
  })
}

const resize = () => window.dispatchEvent(new Event('resize'))

beforeEach(() => {
  localStorage.clear()
  setWindowHeight(720)
})

describe('a pane height derived from the window', () => {
  const derived = (host: ReturnType<typeof fakeHost>) =>
    new DragController(host, {
      localStorageKey: 'testPaneHeight',
      minPosition: 50,
      maxPosition: () => window.innerHeight * 0.9,
      initialPosition: () => window.innerHeight * 0.5,
      getContainerEl: () => Promise.resolve(null),
      direction: Direction.vertical
    })

  it('resolves from the window as it is at construction', () => {
    setWindowHeight(1000)

    expect(positionOf(derived(fakeHost()))).toBe(500)
  })

  it('follows the window when it changes', () => {
    const host = fakeHost()
    const drag = derived(host)
    expect(positionOf(drag)).toBe(360)

    setWindowHeight(1440)
    resize()

    // The whole bug: this used to stay at its construction-time value forever.
    expect(positionOf(drag)).toBe(720)
    expect(host.updates).toBeGreaterThan(0)
  })

  it('stays inside its own bounds while following', () => {
    const drag = derived(fakeHost())

    setWindowHeight(80)
    resize()

    // 50% of 80 is under the 50px floor.
    expect(positionOf(drag)).toBe(50)
  })
})

describe('a pane height the user chose', () => {
  const chosen = (host: ReturnType<typeof fakeHost>) =>
    new DragController(host, {
      localStorageKey: 'testPaneHeight',
      minPosition: 50,
      maxPosition: () => window.innerHeight * 0.5,
      initialPosition: () => window.innerHeight * 0.9,
      getContainerEl: () => Promise.resolve(null),
      direction: Direction.vertical
    })

  it('wins over the derived default', () => {
    localStorage.setItem('testPaneHeight', '300')

    expect(positionOf(chosen(fakeHost()))).toBe(300)
  })

  it('keeps winning when the window changes and it still fits', () => {
    localStorage.setItem('testPaneHeight', '300')
    const drag = chosen(fakeHost())

    setWindowHeight(1440)
    resize()

    // Not recomputed to 90% of the new window: the user picked this.
    expect(positionOf(drag)).toBe(300)
  })

  it('is pulled back inside a window that no longer has room', () => {
    localStorage.setItem('testPaneHeight', '300')
    const drag = chosen(fakeHost())

    setWindowHeight(400)
    resize()

    // Max is half the window; a stored height outliving its room would push the
    // handle off-screen.
    expect(positionOf(drag)).toBe(200)
  })
})

describe('every controller on the page, not just the last one built', () => {
  it('each follows the window independently', () => {
    // `window.onresize` is a single slot, so five controllers assigning it left
    // only the last one adjusting — which is why nothing re-fitted.
    const build = (ratio: number) =>
      new DragController(fakeHost(), {
        minPosition: 10,
        initialPosition: () => window.innerHeight * ratio,
        getContainerEl: () => Promise.resolve(null),
        direction: Direction.vertical
      })
    const first = build(0.25)
    const second = build(0.5)

    setWindowHeight(1000)
    resize()

    expect([positionOf(first), positionOf(second)]).toEqual([250, 500])
  })
})

describe('minWorkbenchHeight', () => {
  it('reads the window at call time, not at import time', () => {
    setWindowHeight(2000)
    expect(minWorkbenchHeight()).toBe(300)

    // The frozen value is what pinned the pane: loaded in a 413px window it is
    // 124px, and it is also the pane's own minimum.
    setWindowHeight(413)
    expect(Math.round(minWorkbenchHeight())).toBe(124)
  })
})

/**
 * Lit detaches and reattaches a host without rebuilding its controllers, so a
 * listener registered once in the constructor and removed on disconnect leaves
 * that pane deaf to every later resize.
 */
describe('a host that reconnects', () => {
  const build = (host: ReturnType<typeof fakeHost>) =>
    new DragController(host, {
      minPosition: 10,
      initialPosition: () => window.innerHeight * 0.5,
      getContainerEl: () => Promise.resolve(null),
      direction: Direction.vertical
    })

  it('follows the window again after a detach and reattach', () => {
    const host = fakeHost()
    const drag = build(host)

    drag.hostDisconnected()
    drag.hostConnected()
    setWindowHeight(1440)
    resize()

    expect(positionOf(drag)).toBe(720)
  })

  it('does not double-subscribe across repeated connects', () => {
    const host = fakeHost()
    const drag = build(host)
    drag.hostConnected()
    drag.hostConnected()
    const before = host.updates

    setWindowHeight(1000)
    resize()

    // One update per resize however many times it connected: the same listener
    // reference cannot be added twice.
    expect(host.updates - before).toBe(1)
  })
})

/**
 * A controller's derived default is resolved during construction, and a host
 * that builds its controllers as field initializers has not yet received any
 * consumed context — so the inputs of the derivation can arrive later.
 */
describe('a derived default whose inputs arrive late', () => {
  it('re-derives when told an input changed', () => {
    let ratio = 0.5
    const drag = new DragController(fakeHost(), {
      minPosition: 10,
      initialPosition: () => 1000 * ratio,
      getContainerEl: () => Promise.resolve(null),
      direction: Direction.horizontal
    })
    expect(positionOf(drag)).toBe(500)

    ratio = 0.46
    expect(drag.refreshDerived()).toBe(true)
    expect(positionOf(drag)).toBe(460)
    // Idempotent: nothing moved the second time, so a caller can guard a
    // re-render on the return value.
    expect(drag.refreshDerived()).toBe(false)
  })

  it('leaves a chosen position alone', () => {
    localStorage.setItem('testPaneHeight', '300')
    let ratio = 0.5
    const drag = new DragController(fakeHost(), {
      localStorageKey: 'testPaneHeight',
      minPosition: 10,
      initialPosition: () => 1000 * ratio,
      getContainerEl: () => Promise.resolve(null),
      direction: Direction.horizontal
    })

    ratio = 0.46
    expect(drag.refreshDerived()).toBe(false)
    expect(positionOf(drag)).toBe(300)
  })
})

describe('teardown', () => {
  it('stops following once the host disconnects', () => {
    const host = fakeHost()
    const drag = new DragController(host, {
      minPosition: 10,
      initialPosition: () => window.innerHeight * 0.5,
      getContainerEl: () => Promise.resolve(null),
      direction: Direction.vertical
    })
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    drag.hostDisconnected()
    setWindowHeight(1440)
    resize()

    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(positionOf(drag)).toBe(360)
    removeSpy.mockRestore()
  })
})
