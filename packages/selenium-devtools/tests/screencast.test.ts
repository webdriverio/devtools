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
})
