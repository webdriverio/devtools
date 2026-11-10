import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ScreencastRecorderBase,
  type ScreencastLogger
} from '../src/screencast.js'
import { MAX_FILMSTRIP_GAP_INTERVALS } from '../src/screencast.js'
import {
  DRIVER_ACTIVITY_MAX_HOLD_MS,
  beginDriverCapture,
  beginDriverCommand
} from '../src/driver-activity.js'

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

  it('skips non-string or empty frames returned during polling without stopping', async () => {
    vi.useFakeTimers()
    let n = 0
    class MalformedMid extends TestRecorder {
      protected override async takeScreenshot() {
        n++
        if (n === 2) {
          return {
            message: 'Session not started or terminated'
          } as unknown as string
        }
        if (n === 3) {
          return ''
        }
        return `f-${n}`
      }
    }
    const r = new MalformedMid({ pollIntervalMs: 50 })
    await r.start({ name: 'driver' })
    await vi.advanceTimersByTimeAsync(150) // ticks 2 (object), 3 (empty), 4 (valid)
    await r.stop()
    expect(r.frames.map((f) => f.data)).toEqual(['f-1', 'f-4'])
    vi.useRealTimers()
  })
})

describe('ScreencastRecorderBase: driver-activity gate', () => {
  it('drops ticks while a command is in flight, resumes once it settles', async () => {
    vi.useFakeTimers()
    const r = new TestRecorder({ pollIntervalMs: 50 })
    await r.start({ name: 'driver' })
    const suppressed = r.bufferLength
    const close = beginDriverCommand('getText')
    try {
      await vi.advanceTimersByTimeAsync(100) // 2 ticks inside the gap cap, skipped
      expect(r.bufferLength).toBe(suppressed)
    } finally {
      close()
    }
    await vi.advanceTimersByTimeAsync(150)
    expect(r.bufferLength).toBeGreaterThan(suppressed)
    await r.stop()
    vi.useRealTimers()
  })

  it('drops ticks while a per-action capture holds the driver', async () => {
    vi.useFakeTimers()
    const r = new TestRecorder({ pollIntervalMs: 50 })
    await r.start({ name: 'driver' })
    const shots = r.shotsTaken
    const close = beginDriverCapture()
    try {
      await vi.advanceTimersByTimeAsync(100)
      expect(r.shotsTaken).toBe(shots)
    } finally {
      close()
    }
    await vi.advanceTimersByTimeAsync(50)
    expect(r.shotsTaken).toBe(shots + 1)
    await r.stop()
    vi.useRealTimers()
  })

  it('keeps polling through a wait, whose polls signal on their own', async () => {
    vi.useFakeTimers()
    const r = new TestRecorder({ pollIntervalMs: 50 })
    await r.start({ name: 'driver' })
    const before = r.bufferLength
    const close = beginDriverCommand('waitForDisplayed')
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
    const close = beginDriverCommand('click')
    try {
      await vi.advanceTimersByTimeAsync(150)
      expect(r.bufferLength).toBe(stalled)
      await vi.advanceTimersByTimeAsync(DRIVER_ACTIVITY_MAX_HOLD_MS)
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
    await r.stop()
  })
})

describe('ScreencastRecorderBase — handshake ceiling', () => {
  it('a first shot that never settles still lets start() and a queued stop() resolve', async () => {
    vi.useFakeTimers()
    try {
      class HungFirst extends TestRecorder {
        unavailable: unknown[] = []
        protected override takeScreenshot(): Promise<string | null> {
          return new Promise<string | null>(() => {})
        }
        protected override onUnavailable(err: unknown): void {
          this.unavailable.push(err)
        }
      }
      const r = new HungFirst({ pollIntervalMs: 50 })
      const starting = r.start({ name: 'driver' })
      const stopping = r.stop()
      await vi.advanceTimersByTimeAsync(5000)
      await Promise.all([starting, stopping])
      expect(r.isRecording).toBe(false)
      expect(r.unavailable).toHaveLength(1)
      expect((r.unavailable[0] as Error).message).toBe(
        'first screenshot timed out'
      )
    } finally {
      vi.useRealTimers()
    }
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

describe('ScreencastRecorderBase: lifecycle logging', () => {
  function makeLogger() {
    const lines: Array<[string, string]> = []
    const logger: ScreencastLogger = {
      info: (m) => lines.push(['info', m]),
      warn: (m) => lines.push(['warn', m])
    }
    return { logger, lines }
  }

  it('reports polling start and stop through the adapter logger', async () => {
    const { logger, lines } = makeLogger()
    class Logged extends TestRecorder {
      protected override readonly logger = logger
    }
    const r = new Logged({ pollIntervalMs: 50 })
    await r.start({ name: 'driver' })
    await r.stop()
    expect(lines).toEqual([
      ['info', '✓ Screencast recording started (polling mode, 50 ms interval)'],
      ['info', '✓ Screencast stopped — 1 frame(s) collected']
    ])
  })

  it('warns with the cause when the first shot cannot be taken', async () => {
    const { logger, lines } = makeLogger()
    class Logged extends TestRecorder {
      protected override readonly logger = logger
    }
    const r = new Logged({ pollIntervalMs: 50 })
    r.shouldFailFirst = true
    await r.start({ name: 'driver' })
    expect(lines).toEqual([
      [
        'warn',
        'Screencast unavailable (first screenshot returned null). Recording skipped.'
      ]
    ])
  })

  it('stays silent without a logger', async () => {
    const r = new TestRecorder({ pollIntervalMs: 50 })
    r.shouldFailFirst = true
    await expect(r.start({ name: 'driver' })).resolves.toBeUndefined()
    expect(r.isRecording).toBe(false)
  })
})

describe('ScreencastRecorderBase: reused capture screenshots', () => {
  it('keeps a capture screenshot as a frame, in order, and skips the poll it replaces', async () => {
    vi.useFakeTimers()
    const r = new TestRecorder({ pollIntervalMs: 50 })
    await r.start({ name: 'driver' })
    await vi.advanceTimersByTimeAsync(30)
    ScreencastRecorderBase.offerCapturedFrame('capture-1', Date.now())
    await vi.advanceTimersByTimeAsync(20) // tick 20 ms after the capture: skipped
    expect(r.shotsTaken).toBe(1)
    await vi.advanceTimersByTimeAsync(50) // the next one polls again
    expect(r.shotsTaken).toBe(2)
    await r.stop()

    expect(r.frames.map((f) => f.data)).toEqual([
      'frame-1',
      'capture-1',
      'frame-2'
    ])
    const stamps = r.frames.map((f) => f.timestamp)
    expect([...stamps].sort((a, b) => a - b)).toEqual(stamps)
    vi.useRealTimers()
  })

  it('drops a shot no newer than the newest frame, so nothing is duplicated or reordered', async () => {
    vi.useFakeTimers()
    const r = new TestRecorder({ pollIntervalMs: 50 })
    await r.start({ name: 'driver' })
    const newest = r.frames[r.frames.length - 1].timestamp
    ScreencastRecorderBase.offerCapturedFrame('stale', newest - 1)
    await vi.advanceTimersByTimeAsync(10)
    const at = Date.now()
    ScreencastRecorderBase.offerCapturedFrame('capture', at)
    ScreencastRecorderBase.offerCapturedFrame('capture', at)
    await r.stop()
    expect(r.frames.map((f) => f.data)).toEqual(['frame-1', 'capture'])
    vi.useRealTimers()
  })

  it('takes nothing once stopped, from CDP push mode, or while two recorders record', async () => {
    class PushRecorder extends TestRecorder {
      protected override async tryStartCdp(): Promise<boolean> {
        return true
      }
    }
    const push = new PushRecorder()
    await push.start({ name: 'chrome' })
    ScreencastRecorderBase.offerCapturedFrame('to-push', Date.now() + 1)
    expect(push.bufferLength).toBe(0)

    const polling = new TestRecorder({ pollIntervalMs: 60_000 })
    await polling.start({ name: 'safari' })
    ScreencastRecorderBase.offerCapturedFrame('ambiguous', Date.now() + 1)
    expect(polling.bufferLength).toBe(1)

    await push.stop()
    ScreencastRecorderBase.offerCapturedFrame('mine', Date.now() + 2)
    expect(polling.frames.map((f) => f.data)).toEqual(['frame-1', 'mine'])

    await polling.stop()
    ScreencastRecorderBase.offerCapturedFrame('after-stop', Date.now() + 3)
    expect(polling.bufferLength).toBe(2)
  })

  it('bounds reused frames by maxBufferFrames like polled ones', async () => {
    const r = new TestRecorder({ pollIntervalMs: 60_000, maxBufferFrames: 4 })
    await r.start({ name: 'driver' })
    const t0 = Date.now()
    for (let i = 1; i <= 10; i++) {
      ScreencastRecorderBase.offerCapturedFrame(`capture-${i}`, t0 + i)
    }
    await r.stop()
    expect(r.bufferLength).toBeLessThanOrEqual(4)
    expect(r.frames[0].data).toBe('frame-1')
    expect(r.frames[r.frames.length - 1].data).toBe('capture-10')
  })
})

describe('ScreencastRecorderBase: gap cap while the driver stays busy', () => {
  const INTERVAL = 50
  const CAP = INTERVAL * MAX_FILMSTRIP_GAP_INTERVALS

  function largestGap(r: TestRecorder): number {
    const stamps = r.frames.map((f) => f.timestamp)
    return Math.max(...stamps.slice(1).map((t, i) => t - stamps[i]))
  }

  it('polls through back-to-back commands once the newest frame reaches the cap', async () => {
    vi.useFakeTimers()
    const r = new TestRecorder({ pollIntervalMs: INTERVAL })
    await r.start({ name: 'driver' })
    // Live mode on Safari or Appium: reads only, no capture to reuse, and each
    // command opens before the previous one closes.
    let close = beginDriverCommand('getText')
    for (let i = 0; i < 40; i++) {
      await vi.advanceTimersByTimeAsync(25)
      const next = beginDriverCommand(i % 2 ? 'findElements' : 'isDisplayed')
      close()
      close = next
    }
    close()
    await r.stop()
    expect(r.frames.length).toBeGreaterThan(1000 / CAP - 1)
    expect(largestGap(r)).toBeLessThanOrEqual(CAP)
    vi.useRealTimers()
  })

  it('issues no poll while a capture window is open, however stale the filmstrip', async () => {
    vi.useFakeTimers()
    const r = new TestRecorder({ pollIntervalMs: INTERVAL })
    await r.start({ name: 'driver' })
    const shots = r.shotsTaken
    // A native capture runs 1.4 to 2.4 s; a capped poll would only queue behind its own screenshot.
    const close = beginDriverCapture()
    try {
      await vi.advanceTimersByTimeAsync(CAP * 4)
      expect(r.shotsTaken).toBe(shots)
    } finally {
      close()
    }
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(r.shotsTaken).toBe(shots + 1)
    await r.stop()
    vi.useRealTimers()
  })

  it('still applies the cap to a non-input command held as long', async () => {
    vi.useFakeTimers()
    const r = new TestRecorder({ pollIntervalMs: INTERVAL })
    await r.start({ name: 'driver' })
    const close = beginDriverCommand('execute')
    try {
      await vi.advanceTimersByTimeAsync(CAP * 4)
    } finally {
      close()
    }
    await r.stop()
    expect(r.frames.length).toBeGreaterThanOrEqual(5)
    expect(largestGap(r)).toBeLessThanOrEqual(CAP)
    vi.useRealTimers()
  })

  it('never overrides an input command, however stale the filmstrip', async () => {
    vi.useFakeTimers()
    const r = new TestRecorder({ pollIntervalMs: INTERVAL })
    await r.start({ name: 'driver' })
    const shots = r.shotsTaken
    const close = beginDriverCommand('click')
    try {
      await vi.advanceTimersByTimeAsync(CAP * 4)
      expect(r.shotsTaken).toBe(shots)
    } finally {
      close()
    }
    await r.stop()
    vi.useRealTimers()
  })
})
