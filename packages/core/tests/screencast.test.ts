import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ScreencastRecorderBase } from '../src/screencast.js'

class TestRecorder extends ScreencastRecorderBase<{ name: string }> {
  shotsTaken = 0
  shouldFailFirst = false
  shouldThrowFirst = false

  protected override async takeScreenshot(): Promise<string | null> {
    this.shotsTaken++
    if (this.shouldThrowFirst && this.shotsTaken === 1) {
      throw new Error('first-shot threw')
    }
    if (this.shouldFailFirst && this.shotsTaken === 1) {
      return null
    }
    return `frame-${this.shotsTaken}`
  }

  get bufferLength(): number {
    return this.buffer.length
  }
}

beforeEach(() => {
  vi.useRealTimers()
})

describe('ScreencastRecorderBase — polling path', () => {
  it('start() enters recording state; second start() is a no-op', async () => {
    const r = new TestRecorder({ pollIntervalMs: 50 })
    await r.start({ name: 'a' })
    expect(r.isRecording).toBe(true)
    const shots = r.shotsTaken
    await r.start({ name: 'b' }) // ignored — already recording
    expect(r.shotsTaken).toBe(shots)
    await r.stop()
    expect(r.isRecording).toBe(false)
  })

  it('does not record when the first screenshot returns null or throws', async () => {
    const nullR = new TestRecorder({ pollIntervalMs: 50 })
    nullR.shouldFailFirst = true
    await nullR.start({ name: 'driver' })
    expect(nullR.isRecording).toBe(false)

    const throwR = new TestRecorder({ pollIntervalMs: 50 })
    throwR.shouldThrowFirst = true
    await throwR.start({ name: 'driver' })
    expect(throwR.isRecording).toBe(false)
  })

  it('captures multiple frames at the configured interval', async () => {
    vi.useFakeTimers()
    const r = new TestRecorder({ pollIntervalMs: 50 })
    await r.start({ name: 'driver' })
    expect(r.bufferLength).toBe(1) // initial shot
    await vi.advanceTimersByTimeAsync(150) // 3 more ticks
    expect(r.bufferLength).toBeGreaterThanOrEqual(4)
    await r.stop()
    vi.useRealTimers()
  })

  it('stops polling silently when a mid-stream screenshot throws (session-death case)', async () => {
    vi.useFakeTimers()
    let n = 0
    class FailMid extends TestRecorder {
      protected override async takeScreenshot() {
        n++
        if (n > 2) {
          throw new Error('session gone')
        }
        return `f-${n}`
      }
    }
    const r = new FailMid({ pollIntervalMs: 50 })
    await r.start({ name: 'driver' })
    await vi.advanceTimersByTimeAsync(50) // shot 2 ok
    await vi.advanceTimersByTimeAsync(50) // shot 3 throws → loop stops
    const after = r.bufferLength
    await vi.advanceTimersByTimeAsync(200) // no more frames
    expect(r.bufferLength).toBe(after)
    vi.useRealTimers()
  })
})

describe('ScreencastRecorderBase — frames / setStartMarker / duration', () => {
  it('setStartMarker trims preceding frames from the public getter', async () => {
    class CdpFlavor extends ScreencastRecorderBase<{ name: string }> {
      protected override async takeScreenshot() {
        return null
      }
      protected override async tryStartCdp() {
        return true
      }
      push(d: string, t: number) {
        this.pushCdpFrame(d, t)
      }
    }
    const r = new CdpFlavor()
    await r.start({ name: 'driver' })
    r.push('a', 1)
    r.push('b', 2)
    r.setStartMarker() // anchor at end of buffer
    r.push('after', 3)
    expect(r.frames.length).toBe(1)
    expect(r.frames[0].data).toBe('after')
    await r.stop()
  })

  it('duration is the ms span between first and last frame (CDP-timestamps in seconds → ms)', async () => {
    class CdpOnly extends ScreencastRecorderBase<{ name: string }> {
      protected override async takeScreenshot() {
        return null
      }
      protected override async tryStartCdp() {
        return true
      }
      push(d: string, t: number) {
        this.pushCdpFrame(d, t)
      }
    }
    const r = new CdpOnly()
    await r.start({ name: 'driver' })
    r.push('a', 1) // 1000ms
    r.push('b', 3) // 3000ms
    expect(r.duration).toBe(2000)
    await r.stop()
  })
})

describe('ScreencastRecorderBase — CDP override path', () => {
  it('tryStartCdp returning true skips the polling path entirely', async () => {
    class CdpRecorder extends ScreencastRecorderBase<{ name: string }> {
      pollAttempted = false
      protected override async takeScreenshot() {
        this.pollAttempted = true
        return null
      }
      protected override async tryStartCdp() {
        return true
      }
    }
    const r = new CdpRecorder()
    await r.start({ name: 'driver' })
    expect(r.pollAttempted).toBe(false)
    expect(r.isRecording).toBe(true)
    await r.stop()
  })
})
