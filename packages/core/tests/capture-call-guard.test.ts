import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Bidi from '../src/bidi.js'
import type * as ScriptLoader from '../src/script-loader.js'

const loadSeleniumSubmodule = vi.hoisted(() => vi.fn())

vi.mock('../src/bidi.js', async (importOriginal) => ({
  ...(await importOriginal<typeof Bidi>()),
  loadSeleniumSubmodule
}))
vi.mock('../src/script-loader.js', async (importOriginal) => ({
  ...(await importOriginal<typeof ScriptLoader>()),
  loadCollectorSource: async () => '/* collector */'
}))

import {
  BIDI_SETUP_TIMEOUT_MS,
  CAPTURE_CALL_TIMED_OUT,
  CaptureCallGuard,
  captureCallGuardFor,
  captureCeilingsApply,
  type CaptureSession
} from '../src/capture-call-guard.js'
import { registerCollectorPreload } from '../src/bidi-preload.js'
import { attachNetworkInspector, buildBidiSinks } from '../src/bidi.js'
import { drainCollectorWithRecovery } from '../src/script-loader.js'
import { captureActionSnapshot } from '../src/action-snapshot.js'
import { SNAPSHOT_DRIVER_PROBE_TIMEOUT_MS } from '../src/with-timeout.js'

const chrome = (browserVersion: string): CaptureSession['capabilities'] => ({
  browserName: 'chrome',
  browserVersion
})

const hung = <T>() => new Promise<T>(() => {})

function guardFor(session: CaptureSession) {
  const log = vi.fn()
  return { guard: new CaptureCallGuard(() => session, log), log }
}

const affected = () =>
  guardFor({ sessionId: 's1', capabilities: chrome('157.0.1') })

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  loadSeleniumSubmodule.mockReset()
})

describe('CaptureCallGuard on Chrome 156/157', () => {
  it('cuts a call that never answers off at its ceiling, aborting its signal', async () => {
    const { guard } = affected()
    let signal: AbortSignal | undefined
    let settled: unknown = 'pending'
    void guard
      .run(
        (s) => {
          signal = s
          return hung<string>()
        },
        4000,
        'fallback',
        'drain'
      )
      .then((v) => {
        settled = v
      })
    await vi.advanceTimersByTimeAsync(3999)
    expect(settled).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe('fallback')
    expect(signal?.aborted).toBe(true)
  })

  it('keeps trying after a timeout, and warns once per session', async () => {
    const session: CaptureSession = {
      sessionId: 's1',
      capabilities: chrome('157.0.1')
    }
    const { guard, log } = guardFor(session)
    const first = guard.run(() => hung(), 100, null, 'collector drain')
    await vi.advanceTimersByTimeAsync(100)
    await first

    const call = vi.fn(async () => 'data')
    await expect(guard.run(call, 100, null, 'collector drain')).resolves.toBe(
      'data'
    )
    expect(call).toHaveBeenCalledTimes(1)
    guard.timedOut('action snapshot screenshot probe')
    expect(log).toHaveBeenCalledTimes(1)
    const message = log.mock.calls[0][1] as string
    expect(message).toContain(
      'collector drain timed out on Chrome 157, which hangs WebDriver BiDi commands to tabs opened by window.open()'
    )
    expect(message).toContain('crbug 571161446')
    expect(message).toContain('158.0.8106.0')
    expect(message).toContain('Capture keeps trying')

    session.sessionId = 's2'
    guard.timedOut('collector drain')
    expect(log).toHaveBeenCalledTimes(2)
  })

  it('warns that the session falls back when a setup call times out', async () => {
    const { guard, log } = affected()
    let signal: AbortSignal | undefined
    const setup = guard.setup(
      (s) => {
        signal = s
        return hung<boolean>()
      },
      BIDI_SETUP_TIMEOUT_MS,
      false,
      'BiDi preload registration'
    )
    await vi.advanceTimersByTimeAsync(BIDI_SETUP_TIMEOUT_MS)
    await expect(setup).resolves.toBe(false)
    expect(signal?.aborted).toBe(true)
    expect(log.mock.calls[0][1]).toContain('falls back')
  })

  it('passes an answer and a rejection that arrive in time through untouched', async () => {
    const { guard, log } = affected()
    await expect(guard.run(async () => 7, 10, 0, 'read')).resolves.toBe(7)
    await expect(
      guard.run(() => Promise.reject(new Error('gone')), 10, 0, 'read')
    ).rejects.toThrow('gone')
    expect(log).not.toHaveBeenCalled()
  })
})

describe('CaptureCallGuard on every other browser', () => {
  it.each([
    ['Chrome 155', chrome('155.0.1')],
    ['Chrome 158', chrome('158.0.8106.0')],
    ['Firefox', { browserName: 'firefox', browserVersion: '157.0' }],
    [
      'Chrome 157 through Appium',
      { ...(chrome('157.0.1') as object), platformName: 'Android' }
    ],
    ['no capabilities', undefined]
  ])(
    'adds no ceiling on %s: a slow drain still returns its data',
    async (_name, capabilities) => {
      const { guard, log } = guardFor({ sessionId: 's1', capabilities })
      let settled: unknown = 'pending'
      void guard
        .run(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ mutations: [1] }), 60_000)
            ),
          5000,
          CAPTURE_CALL_TIMED_OUT,
          'collector drain'
        )
        .then((v) => {
          settled = v
        })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(settled).toEqual({ mutations: [1] })
      guard.timedOut('a probe')
      expect(log).not.toHaveBeenCalled()
      expect(guard.applies).toBe(false)
    }
  )

  it('reads ceilings as Chrome 156/157 off Appium only', () => {
    expect(captureCeilingsApply(chrome('156.0.1'))).toBe(true)
    expect(
      captureCeilingsApply({
        ...(chrome('157.0.1') as object),
        'appium:udid': 'x'
      })
    ).toBe(false)
  })

  it('shares one guard per browser object', () => {
    const browser = { sessionId: 'a', capabilities: chrome('156.0.1') }
    const log = vi.fn()
    expect(captureCallGuardFor(browser, log)).toBe(
      captureCallGuardFor(browser, log)
    )
  })
})

describe('a drain cut off by its ceiling', () => {
  it('is not taken for a missing collector, so nothing is re-injected', async () => {
    const { guard } = affected()
    const inject = vi.fn(async () => {})
    const currentUrl = vi.fn(async () => 'http://x/')
    const pending = drainCollectorWithRecovery({
      drain: () =>
        guard.run(
          () => hung<unknown>(),
          5000,
          CAPTURE_CALL_TIMED_OUT,
          'collector drain'
        ),
      injectIntoCurrentDocument: inject,
      currentUrl
    })
    await vi.advanceTimersByTimeAsync(5000)
    await expect(pending).resolves.toBeNull()
    expect(inject).not.toHaveBeenCalled()
    expect(currentUrl).not.toHaveBeenCalled()
  })
})

describe('BiDi setup answered after its ceiling', () => {
  it('registers no subscription once the ceiling has passed', async () => {
    let answer!: (inspector: unknown) => void
    const inspector = {
      beforeRequestSent: vi.fn(async () => {}),
      responseCompleted: vi.fn(async () => {})
    }
    const { guard } = affected()
    const attached = guard.setup(
      (signal) =>
        attachNetworkInspector(
          {},
          () => new Promise((resolve) => (answer = resolve)),
          {
            pushConsoleLog: vi.fn(),
            pushNetworkRequest: vi.fn(),
            replaceNetworkRequest: vi.fn()
          },
          () => {},
          signal
        ),
      BIDI_SETUP_TIMEOUT_MS,
      false,
      'BiDi network subscription'
    )
    await vi.advanceTimersByTimeAsync(BIDI_SETUP_TIMEOUT_MS)
    await expect(attached).resolves.toBe(false)
    answer(inspector)
    await vi.advanceTimersByTimeAsync(0)
    expect(inspector.beforeRequestSent).not.toHaveBeenCalled()
    expect(inspector.responseCompleted).not.toHaveBeenCalled()
  })

  it('keeps a handler registered just before the ceiling inert', async () => {
    const controller = new AbortController()
    const sinks = {
      pushConsoleLog: vi.fn(),
      pushNetworkRequest: vi.fn(),
      replaceNetworkRequest: vi.fn()
    }
    let onRequest: ((event: unknown) => void) | undefined
    const attached = attachNetworkInspector(
      {},
      async () => ({
        beforeRequestSent: async (cb: (event: unknown) => void) => {
          onRequest = cb
          controller.abort()
        },
        responseCompleted: vi.fn(async () => {})
      }),
      sinks,
      () => {},
      controller.signal
    )
    await expect(attached).resolves.toBe(false)
    onRequest?.({ request: { request: 'r1', url: 'http://x/' } })
    expect(sinks.pushNetworkRequest).not.toHaveBeenCalled()
  })

  it('sets no BiDi evidence from an event delivered while a later subscription is still waiting', async () => {
    const target = {
      consoleLogs: [],
      networkRequests: [],
      sendUpstream: vi.fn(),
      bidiNetworkObserved: false
    }
    let onRequest: ((event: unknown) => void) | undefined
    const { guard } = affected()
    const attached = guard.setup(
      (signal) =>
        attachNetworkInspector(
          {},
          async () => ({
            beforeRequestSent: async (cb: (event: unknown) => void) => {
              onRequest = cb
            },
            responseCompleted: () => hung<void>()
          }),
          buildBidiSinks(target),
          () => {},
          signal
        ),
      BIDI_SETUP_TIMEOUT_MS,
      false,
      'BiDi network subscription'
    )
    await vi.advanceTimersByTimeAsync(0)
    onRequest?.({ request: { request: 'r1', url: 'http://x/' } })
    await vi.advanceTimersByTimeAsync(BIDI_SETUP_TIMEOUT_MS)
    await expect(attached).resolves.toBe(false)
    expect(target.bidiNetworkObserved).toBe(false)
    expect(target.networkRequests).toEqual([])
  })

  it('passes events through once every subscription has answered', async () => {
    const sinks = {
      pushConsoleLog: vi.fn(),
      pushNetworkRequest: vi.fn(),
      replaceNetworkRequest: vi.fn()
    }
    let onRequest: ((event: unknown) => void) | undefined
    const attached = await attachNetworkInspector(
      {},
      async () => ({
        beforeRequestSent: async (cb: (event: unknown) => void) => {
          onRequest = cb
        },
        responseCompleted: async () => {}
      }),
      sinks,
      () => {}
    )
    expect(attached).toBe(true)
    onRequest?.({ request: { request: 'r1', url: 'http://x/' } })
    expect(sinks.pushNetworkRequest).toHaveBeenCalledTimes(1)
  })

  it('removes a preload registration that answers late, and falls back', async () => {
    let answer!: (id: number) => void
    const manager = {
      addPreloadScript: vi.fn(
        () => new Promise<number>((resolve) => (answer = resolve))
      ),
      removePreloadScript: vi.fn(async () => {})
    }
    loadSeleniumSubmodule.mockReturnValue(async () => manager)
    const { guard, log } = affected()
    const registered = registerCollectorPreload({}, undefined, guard)
    await vi.advanceTimersByTimeAsync(BIDI_SETUP_TIMEOUT_MS)
    await expect(registered).resolves.toBe(false)
    expect(log).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('BiDi preload registration')
    )
    answer(3)
    await vi.advanceTimersByTimeAsync(0)
    expect(manager.removePreloadScript).toHaveBeenCalledWith(3)
  })
})

describe('captureActionSnapshot under a hung probe', () => {
  it('reports the probe that lost and still returns the snapshot', async () => {
    const onProbeTimeout = vi.fn()
    const pending = captureActionSnapshot({
      command: 'click',
      timestamp: 1,
      getUrl: async () => 'http://x/',
      takeScreenshot: () => hung<string>(),
      onProbeTimeout
    })
    await vi.advanceTimersByTimeAsync(SNAPSHOT_DRIVER_PROBE_TIMEOUT_MS)
    const snapshot = await pending
    expect(snapshot?.url).toBe('http://x/')
    expect(snapshot?.screenshot).toBeUndefined()
    expect(onProbeTimeout).toHaveBeenCalledWith(
      'action snapshot screenshot probe'
    )
  })
})
