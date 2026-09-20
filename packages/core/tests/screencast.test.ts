import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ScreencastRecorderBase } from '../src/screencast.js'
import {
  INPUT_DISPATCH_MAX_HOLD_MS,
  beginInputDispatch
} from '../src/input-dispatch.js'

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

  it('tears down a loop that a stop() during the first shot has cancelled', async () => {
    vi.useFakeTimers()
    let release: ((value: string) => void) | undefined
    class SlowFirst extends TestRecorder {
      shotIssued!: () => void
      readonly firstShot = new Promise<void>((resolve) => {
        this.shotIssued = resolve
      })

      protected override takeScreenshot(): Promise<string | null> {
        this.shotsTaken++
        this.shotIssued()
        return new Promise((resolve) => {
          release = resolve
        })
      }
    }
    const r = new SlowFirst({ pollIntervalMs: 50 })
    const starting = r.start({ name: 'driver' })
    await r.firstShot
    // Queued behind the handshake, so the stop now runs against a start that
    // finished arming: what it has to clear is a live timer, not a pending one.
    const stopping = r.stop()
    release?.('late-shot')
    await Promise.all([starting, stopping])
    await vi.advanceTimersByTimeAsync(500)

    expect(r.isRecording).toBe(false)
    // The shot was already issued when the stop took effect, so it is the one
    // frame the recording holds; the interval it armed must add no more.
    expect(r.bufferLength).toBe(1)
    expect(r.shotsTaken).toBe(1)
    vi.useRealTimers()
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

describe('ScreencastRecorderBase — input-dispatch gate', () => {
  it('drops ticks while an input command is in flight, resumes once it settles', async () => {
    vi.useFakeTimers()
    const r = new TestRecorder({ pollIntervalMs: 50 })
    await r.start({ name: 'driver' })
    const suppressed = r.bufferLength
    const close = beginInputDispatch('click')
    try {
      await vi.advanceTimersByTimeAsync(150) // 3 ticks, all skipped
      expect(r.bufferLength).toBe(suppressed)
    } finally {
      close()
    }
    await vi.advanceTimersByTimeAsync(150)
    expect(r.bufferLength).toBeGreaterThan(suppressed)
    await r.stop()
    vi.useRealTimers()
  })

  it('keeps polling through a command that dispatches no input', async () => {
    vi.useFakeTimers()
    const r = new TestRecorder({ pollIntervalMs: 50 })
    await r.start({ name: 'driver' })
    const before = r.bufferLength
    const close = beginInputDispatch('getText')
    try {
      await vi.advanceTimersByTimeAsync(150)
      expect(r.bufferLength).toBeGreaterThan(before)
    } finally {
      close()
    }
    await r.stop()
    vi.useRealTimers()
  })

  it('resumes after the bound when a command never settles', async () => {
    vi.useFakeTimers()
    const r = new TestRecorder({ pollIntervalMs: 50 })
    await r.start({ name: 'driver' })
    const stalled = r.bufferLength
    // Stands in for a command whose completion callback never fires — a failing
    // Nightwatch test discards the rest of its queue.
    const close = beginInputDispatch('click')
    try {
      await vi.advanceTimersByTimeAsync(150)
      expect(r.bufferLength).toBe(stalled)
      await vi.advanceTimersByTimeAsync(INPUT_DISPATCH_MAX_HOLD_MS)
      expect(r.bufferLength).toBeGreaterThan(stalled)
    } finally {
      close()
    }
    await r.stop()
    vi.useRealTimers()
  })
})

describe('ScreencastRecorderBase — in-flight latch', () => {
  it('keeps at most one screenshot outstanding when a shot outruns the interval', async () => {
    vi.useFakeTimers()
    let shots = 0
    class SlowRecorder extends TestRecorder {
      protected override takeScreenshot(): Promise<string | null> {
        shots++
        // The first shot (before the interval starts) resolves, so recording
        // begins; every later one stays in flight, standing in for a native
        // session's ~1.2 s screenshot against a 200 ms interval. setInterval
        // does not wait, so without the latch ten ticks stack ten requests that
        // a serialised driver then serves ahead of the test's own commands.
        return shots === 1 ? Promise.resolve('initial') : new Promise(() => {})
      }
    }
    const r = new SlowRecorder({ pollIntervalMs: 50 })
    await r.start({ name: 'driver' })
    expect(shots).toBe(1)

    await vi.advanceTimersByTimeAsync(500) // 10 ticks
    expect(shots).toBe(2) // one outstanding; the other nine dropped

    await r.stop()
    vi.useRealTimers()
  })

  it('restarts polling without waiting for a shot orphaned by stop()', async () => {
    vi.useFakeTimers()
    let hanging = true
    let shots = 0
    class Orphaned extends TestRecorder {
      protected override takeScreenshot(): Promise<string | null> {
        shots++
        return hanging && shots > 1
          ? new Promise(() => {})
          : Promise.resolve(`f-${shots}`)
      }
    }
    const r = new Orphaned({ pollIntervalMs: 50 })
    await r.start({ name: 'driver' }) // shot 1 resolves
    await vi.advanceTimersByTimeAsync(50) // shot 2 hangs
    expect(shots).toBe(2)

    await r.stop() // shot 2 is still outstanding
    hanging = false
    await r.start({ name: 'driver' }) // shot 3 resolves, recording resumes
    const started = r.bufferLength
    await vi.advanceTimersByTimeAsync(150)

    // The latch has to clear with the timer, or the restarted loop drops every
    // tick until the orphan from the previous recording settles.
    expect(r.bufferLength).toBeGreaterThan(started)
    await r.stop()
    vi.useRealTimers()
  })

  it('discards a shot that outlived the loop it was issued from', async () => {
    vi.useFakeTimers()
    let release: ((value: string) => void) | undefined
    class Orphan extends TestRecorder {
      protected override takeScreenshot(): Promise<string | null> {
        this.shotsTaken++
        return this.shotsTaken === 1
          ? Promise.resolve('initial')
          : new Promise((resolve) => {
              release = resolve
            })
      }
    }
    const r = new Orphan({ pollIntervalMs: 50 })
    await r.start({ name: 'driver' })
    await vi.advanceTimersByTimeAsync(50) // tick → its shot hangs
    expect(r.bufferLength).toBe(1)

    await r.stop()
    release?.('late-frame')
    await vi.advanceTimersByTimeAsync(60)

    // The frame belongs to the recording that ended — appending it would put a
    // post-stop screenshot into the export.
    expect(r.bufferLength).toBe(1)
    vi.useRealTimers()
  })

  it('releases the latch when a shot settles, so polling continues', async () => {
    vi.useFakeTimers()
    class Bumpy extends TestRecorder {
      protected override async takeScreenshot(): Promise<string | null> {
        this.shotsTaken++
        if (this.shotsTaken === 2) {
          await new Promise((resolve) => setTimeout(resolve, 300))
        }
        return `f-${this.shotsTaken}`
      }
    }
    const r = new Bumpy({ pollIntervalMs: 50 })
    await r.start({ name: 'driver' })
    const initial = r.bufferLength
    await vi.advanceTimersByTimeAsync(50) // tick → slow shot starts
    await vi.advanceTimersByTimeAsync(300) // slow shot settles, ticks resume
    await vi.advanceTimersByTimeAsync(200)
    expect(r.bufferLength).toBeGreaterThan(initial + 1)
    await r.stop()
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

describe('ScreencastRecorderBase — start/stop serialisation', () => {
  class CdpRaceRecorder extends ScreencastRecorderBase<{ name: string }> {
    /** Session ids in arm order, and the one currently held — a single field,
     *  exactly as both CDP overrides keep theirs. */
    armed: string[] = []
    stopped: string[] = []
    session = 'none'
    // Arm numbers whose handshake stays pending until release() — lets a test
    // park start() mid-handshake while stop()/start() land on top of it.
    holdCalls = new Set<number>()
    private gates = new Map<number, (value: boolean) => void>()
    private entered = new Set<number>()
    private enteredWaiters = new Map<number, () => void>()

    protected override async takeScreenshot(): Promise<string | null> {
      return null
    }

    protected override tryStartCdp(): Promise<boolean> {
      const call = this.armed.length + 1
      const id = `s${call}`
      this.armed.push(id)
      this.session = id
      this.entered.add(call)
      this.enteredWaiters.get(call)?.()
      if (this.holdCalls.has(call)) {
        return new Promise<boolean>((resolve) => {
          this.gates.set(call, resolve)
        })
      }
      return Promise.resolve(true)
    }

    protected override async tryStopCdp(): Promise<void> {
      if (this.session === 'none') {
        return
      }
      this.stopped.push(this.session)
      this.session = 'none'
    }

    /** Resolves once arm `call` has been entered, gated or not. */
    armEntered(call: number): Promise<void> {
      if (this.entered.has(call)) {
        return Promise.resolve()
      }
      return new Promise<void>((resolve) => {
        this.enteredWaiters.set(call, resolve)
      })
    }

    release(call: number): void {
      this.gates.get(call)?.(true)
    }
  }

  it('stop() during the CDP handshake still tears the session down', async () => {
    const r = new CdpRaceRecorder()
    r.holdCalls.add(1)
    const starting = r.start({ name: 'driver' })
    await r.armEntered(1)
    // Not awaited here: the queue parks it behind the handshake, and the whole
    // point is that it must run once that handshake has finished arming.
    const stopping = r.stop()
    r.release(1)
    await Promise.all([starting, stopping])
    expect(r.stopped).toEqual(['s1'])
    expect(r.isRecording).toBe(false)
  })

  it('a start landing mid-handshake never has its session torn down', async () => {
    const r = new CdpRaceRecorder()
    r.holdCalls = new Set([1, 2])
    const first = r.start({ name: 'driver' })
    const stopping = r.stop()
    const second = r.start({ name: 'driver' })
    await r.armEntered(1)
    r.release(1)
    await r.armEntered(2)
    r.release(2)
    await Promise.all([first, stopping, second])
    // s1 is the session the stop was for; s2 belongs to the start that followed
    // it and is still recording. Unserialised, the first handshake's stale path
    // stopped s2 and left a dead stream flagged as recording.
    expect(r.stopped).toEqual(['s1'])
    expect(r.session).toBe('s2')
    expect(r.isRecording).toBe(true)
  })
})

describe('ScreencastRecorderBase — buffer cap / decimation', () => {
  class PushRecorder extends ScreencastRecorderBase<{ name: string }> {
    protected override async takeScreenshot() {
      return null
    }
    protected override async tryStartCdp() {
      return true
    }
    push(d: string, t: number) {
      this.pushCdpFrame(d, t)
    }
    get len() {
      return this.buffer.length
    }
  }

  it('never lets the buffer exceed maxBufferFrames across many appends', async () => {
    const cap = 10
    const r = new PushRecorder({ maxBufferFrames: cap })
    await r.start({ name: 'd' })
    for (let i = 0; i < 1000; i++) {
      r.push(`f-${i}`, i)
      expect(r.len).toBeLessThanOrEqual(cap)
    }
    await r.stop()
  })

  it('preserves the first and last frame and the temporal spread (not tail-truncated)', async () => {
    const cap = 100
    const total = 350
    const r = new PushRecorder({ maxBufferFrames: cap })
    await r.start({ name: 'd' })
    for (let i = 0; i < total; i++) {
      r.push(`f-${i}`, i) // pushCdpFrame stores seconds*1000, so timestamp == i*1000
    }
    const frames = r.frames
    expect(frames[0].data).toBe('f-0') // first kept — a tail-truncated buffer would drop it
    expect(frames[frames.length - 1].data).toBe(`f-${total - 1}`) // last kept
    expect(r.duration).toBe((total - 1) * 1000) // spans the whole session

    // Spread survives: frames land in the early, middle, and late thirds of the
    // timeline rather than clustering at either end.
    const times = frames.map((f) => f.timestamp / 1000)
    expect(times.some((t) => t < total / 4)).toBe(true)
    expect(times.some((t) => t > total / 4 && t < (total * 3) / 4)).toBe(true)
    expect(times.some((t) => t > (total * 3) / 4)).toBe(true)
    await r.stop()
  })

  it('keeps setStartMarker semantics and a sane duration across decimation', async () => {
    const cap = 10
    const r = new PushRecorder({ maxBufferFrames: cap })
    await r.start({ name: 'd' })
    for (let i = 0; i < 5; i++) {
      r.push(`pre-${i}`, i) // ts 0..4, before the marker
    }
    r.setStartMarker()
    for (let i = 0; i < 200; i++) {
      r.push(`post-${i}`, 100 + i) // ts 100..299, after the marker — forces many decimations
    }
    const frames = r.frames
    expect(frames.length).toBeGreaterThan(1)
    // No pre-marker frame ever leaks into the public getter.
    expect(frames.every((f) => f.data.startsWith('post-'))).toBe(true)
    // Duration stays within the post-marker time window (ts 100..299 → 199s span in ms).
    expect(r.duration).toBeGreaterThan(0)
    expect(r.duration).toBeLessThanOrEqual(199 * 1000)
    await r.stop()
  })
})
