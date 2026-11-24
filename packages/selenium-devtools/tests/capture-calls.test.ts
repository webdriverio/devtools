import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Metadata } from '@wdio/devtools-shared'
import { SessionCapturer } from '../src/session.js'
import { getDriverOriginals } from '../src/driverPatcher.js'

const capturers: SessionCapturer[] = []
let restore: (() => void) | undefined

afterEach(() => {
  restore?.()
  restore = undefined
  vi.useRealTimers()
  while (capturers.length) {
    capturers.pop()!.cleanup()
  }
})

function capturerOn(browserVersion: string): SessionCapturer {
  const capturer = new SessionCapturer({}, { id: 'd' } as never)
  capturer.metadata = {
    sessionId: 's1',
    capabilities: { browserName: 'chrome', browserVersion }
  } as Metadata
  capturers.push(capturer)
  return capturer
}

function stubExec(impl: (driver: unknown, script: string) => Promise<unknown>) {
  const originals = getDriverOriginals()
  const prev = originals.executeScript
  originals.executeScript = impl as (typeof originals)['executeScript']
  restore = () => {
    if (prev) {
      originals.executeScript = prev
    } else {
      delete originals.executeScript
    }
  }
}

describe('selenium capture calls', () => {
  it('lets a slow drain finish on an unaffected Chrome and keeps its data', async () => {
    vi.useFakeTimers()
    const capturer = capturerOn('158.0.8106.0')
    stubExec(
      (_driver, script) =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                script.includes('getTraceData')
                  ? { mutations: [{ type: 'childList', timestamp: 1 }] }
                  : null
              ),
            30_000
          )
        )
    )
    const inject = vi.spyOn(capturer, 'injectScript')
    const drained = capturer.captureTrace(true)
    await vi.advanceTimersByTimeAsync(30_000)
    await drained
    expect(inject).not.toHaveBeenCalled()
    expect(capturer.mutations.length).toBeGreaterThan(0)
  })

  it('ends an injection at its first cut-off call, so a hung tab costs one ceiling', async () => {
    vi.useFakeTimers()
    const capturer = capturerOn('157.0.1')
    const exec = vi.fn(() => new Promise<unknown>(() => {}))
    stubExec(exec)
    const injection = capturer.injectScript()
    await vi.advanceTimersByTimeAsync(5000)
    await injection
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('stops polling once a readiness poll is cut off', async () => {
    vi.useFakeTimers()
    const capturer = capturerOn('157.0.1')
    let calls = 0
    stubExec(() => {
      calls++
      // probe: absent; inject: not yet ready; first poll: hangs
      return calls === 1
        ? Promise.resolve(false)
        : calls === 2
          ? Promise.resolve(false)
          : new Promise<unknown>(() => {})
    })
    let done = false
    void capturer.injectScript().then(() => {
      done = true
    })
    for (let i = 0; i < 40 && !done; i++) {
      await vi.advanceTimersByTimeAsync(500)
    }
    expect(done).toBe(true)
    expect(calls).toBe(3)
  })

  it('keeps capturing after a timeout, with no state carried to the next call', async () => {
    vi.useFakeTimers()
    const capturer = capturerOn('157.0.1')
    let hang = true
    stubExec((_driver, script) =>
      hang
        ? new Promise<unknown>(() => {})
        : Promise.resolve(
            script.includes('getTraceData')
              ? { mutations: [{ type: 'childList', timestamp: 1 }] }
              : null
          )
    )
    const cutOff = capturer.captureTrace(true)
    await vi.advanceTimersByTimeAsync(5000)
    await cutOff
    hang = false
    await capturer.captureTrace(true)
    expect(capturer.mutations.length).toBeGreaterThan(0)
  })
})
