import { describe, it, expect, vi } from 'vitest'
import { ScreencastRecorder } from '../src/screencast.js'
import { getDriverOriginals } from '../src/driverPatcher.js'
import type { SeleniumDriverLike } from '../src/types.js'

class TestScreencastRecorder extends ScreencastRecorder {
  unavailable: unknown[] = []

  protected override onUnavailable(err: unknown): void {
    this.unavailable.push(err)
  }
}

describe('ScreencastRecorder — CDP handshake ceiling', () => {
  it('a hung createCDPConnection resolves start and a queued stop at the ceiling, and falls back to polling', async () => {
    vi.useFakeTimers()
    try {
      const createCDPConnection = vi.fn(() => new Promise<never>(() => {}))
      // The recorder never calls executeScript; SeleniumDriverLike requires it.
      const driver: SeleniumDriverLike = {
        executeScript: () => Promise.resolve(null),
        createCDPConnection
      }
      getDriverOriginals().takeScreenshot = () => new Promise<string>(() => {})
      const r = new TestScreencastRecorder({ pollIntervalMs: 50 })
      const starting = r.start(driver)
      const stopping = r.stop()
      await vi.advanceTimersByTimeAsync(5000) // CDP handshake ceiling
      await vi.advanceTimersByTimeAsync(5000) // polling first-shot ceiling
      await Promise.all([starting, stopping])
      expect(createCDPConnection).toHaveBeenCalledTimes(1)
      expect(r.isRecording).toBe(false)
      expect(r.unavailable).toHaveLength(1)
      expect((r.unavailable[0] as Error).message).toBe(
        'first screenshot timed out'
      )
    } finally {
      getDriverOriginals().takeScreenshot = undefined
      vi.useRealTimers()
    }
  })

  it('a createCDPConnection that resolves without a websocket falls back to polling', async () => {
    vi.useFakeTimers()
    try {
      const createCDPConnection = vi.fn(async () => ({ execute: vi.fn() }))
      const driver: SeleniumDriverLike = {
        executeScript: () => Promise.resolve(null),
        createCDPConnection
      }
      getDriverOriginals().takeScreenshot = vi.fn(async () => 'frame-1')
      const r = new TestScreencastRecorder({ pollIntervalMs: 50 })
      await r.start(driver)
      expect(createCDPConnection).toHaveBeenCalledTimes(1)
      expect(r.isRecording).toBe(true)
      expect(r.frames).toHaveLength(1)
      expect(r.frames[0].data).toBe('frame-1')
      await r.stop()
      expect(r.isRecording).toBe(false)
    } finally {
      getDriverOriginals().takeScreenshot = undefined
      vi.useRealTimers()
    }
  })

  it('stopping a CDP recording closes the connection it opened', async () => {
    const close = vi.fn()
    const frame = JSON.stringify({
      method: 'Page.screencastFrame',
      params: { data: 'aGk=', sessionId: 1, metadata: { timestamp: 1 } }
    })
    const cdp = {
      execute: vi.fn(),
      _wsConnection: {
        on: (_event: string, listener: (data: unknown) => void) => {
          // Microtask: tryStartCdp arms the first-frame resolver after
          // ws.on returns, so a synchronous fire lands before it exists.
          queueMicrotask(() => listener(frame))
        },
        off: vi.fn(),
        close
      }
    }
    const driver: SeleniumDriverLike = {
      executeScript: () => Promise.resolve(null),
      createCDPConnection: vi.fn().mockResolvedValue(cdp)
    }
    const r = new TestScreencastRecorder({ pollIntervalMs: 50 })
    await r.start(driver)
    expect(r.isRecording).toBe(true)
    expect(cdp.execute).toHaveBeenCalledWith(
      'Page.startScreencast',
      expect.anything()
    )
    await r.stop()
    expect(cdp.execute).toHaveBeenCalledWith('Page.stopScreencast')
    expect(cdp._wsConnection.off).toHaveBeenCalledWith(
      'message',
      expect.any(Function)
    )
    expect(close).toHaveBeenCalledTimes(1)
    expect(r.isRecording).toBe(false)
  })

  it('a createCDPConnection that lands after the ceiling has its socket closed', async () => {
    vi.useFakeTimers()
    try {
      const close = vi.fn()
      const lateConnection = {
        execute: vi.fn(),
        _wsConnection: { on: vi.fn(), close }
      }
      const createCDPConnection = vi.fn(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(lateConnection), 6000)
          )
      )
      const driver: SeleniumDriverLike = {
        executeScript: () => Promise.resolve(null),
        createCDPConnection
      }
      getDriverOriginals().takeScreenshot = () => new Promise<string>(() => {})
      const r = new TestScreencastRecorder({ pollIntervalMs: 50 })
      const starting = r.start(driver)
      const stopping = r.stop()
      await vi.advanceTimersByTimeAsync(11000)
      await Promise.all([starting, stopping])
      expect(r.isRecording).toBe(false)
      expect(close).toHaveBeenCalledTimes(1)
      expect((r.unavailable[0] as Error).message).toBe(
        'first screenshot timed out'
      )
    } finally {
      getDriverOriginals().takeScreenshot = undefined
      vi.useRealTimers()
    }
  })
})
