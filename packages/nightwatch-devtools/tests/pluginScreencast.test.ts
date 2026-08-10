import { describe, it, expect, vi } from 'vitest'
import type { ScreencastFrame } from '@wdio/devtools-shared'
import {
  PluginScreencast,
  resolveScreencastOptions
} from '../src/plugin-screencast.js'
import type { SessionInitCtx } from '../src/session-init.js'
import type { ScreencastRecorder } from '../src/screencast.js'

const frame = (timestamp: number, data: string): ScreencastFrame => ({
  data,
  timestamp
})

/** Structural stand-in: the seam reads only `frames` off the recorder. */
const fakeRecorder = (frames: ScreencastFrame[]): ScreencastRecorder =>
  ({ frames, stop: async () => {} }) as unknown as ScreencastRecorder

describe('resolveScreencastOptions', () => {
  it('enables the recorder in trace mode for a filmstrip or a video policy', () => {
    expect(
      resolveScreencastOptions({
        mode: 'trace',
        filmstrip: true,
        video: 'off',
        screencast: undefined
      }).options.enabled
    ).toBe(true)
    expect(
      resolveScreencastOptions({
        mode: 'trace',
        filmstrip: false,
        video: 'retain-on-failure',
        screencast: undefined
      }).options.enabled
    ).toBe(true)
  })

  it('keeps the user options while forcing it on', () => {
    const resolved = resolveScreencastOptions({
      mode: 'trace',
      filmstrip: true,
      video: 'off',
      screencast: { pollIntervalMs: 500 }
    })
    expect(resolved.options).toEqual({ pollIntervalMs: 500, enabled: true })
    expect(resolved.warning).toBeUndefined()
  })

  it('drops a bare trace-mode screencast and says why', () => {
    // Screencast with neither filmstrip nor video is a live-mode feature; left
    // enabled it would record a session .webm nothing in the trace references.
    const resolved = resolveScreencastOptions({
      mode: 'trace',
      filmstrip: false,
      video: 'off',
      screencast: { enabled: true }
    })
    expect(resolved.options.enabled).toBeUndefined()
    expect(resolved.warning).toContain('live-mode feature')
  })

  it('leaves live mode to the user options', () => {
    expect(
      resolveScreencastOptions({
        mode: 'live',
        filmstrip: true,
        video: 'off',
        screencast: { enabled: true }
      })
    ).toEqual({ options: { enabled: true } })
  })
})

describe('PluginScreencast', () => {
  /** finalize delegates the stop to session-init, which nulls the recorder. */
  function makeCtx(screencast: PluginScreencast): SessionInitCtx {
    return {
      mode: 'trace',
      get screencastRecorder() {
        return screencast.recorder
      },
      set screencastRecorder(v) {
        screencast.recorder = v
      },
      get screencastSessionId() {
        return screencast.sessionId
      },
      set screencastSessionId(v) {
        screencast.sessionId = v
      }
    } as unknown as SessionInitCtx
  }

  it('combines the finalized sessions frames with the live recorder', async () => {
    const screencast = new PluginScreencast({}, true)
    screencast.recorder = fakeRecorder([frame(1, 'a')])
    screencast.sessionId = 'session-1'

    await screencast.finalize(makeCtx(screencast))
    screencast.recorder = fakeRecorder([frame(2, 'b')])

    // A mid-run slice flush reads both: the ended session's frames survive on
    // the run buffer, the live recorder's are still in its own.
    expect(screencast.frames.map((f) => f.data)).toEqual(['a', 'b'])
  })

  it('applies the shared recorder defaults over the given options', () => {
    const screencast = new PluginScreencast({ pollIntervalMs: 50 }, true)
    expect(screencast.options.pollIntervalMs).toBe(50)
    expect(screencast.options.captureFormat).toBe('jpeg')
  })

  it('drops the frames when nothing will consume them', async () => {
    // No filmstrip and no per-test video: keeping every frame of every session
    // would grow unbounded for a buffer nothing reads.
    const screencast = new PluginScreencast({}, false)
    screencast.recorder = fakeRecorder([frame(1, 'a')])
    screencast.sessionId = 'session-1'

    await screencast.finalize(makeCtx(screencast))

    expect(screencast.frames).toEqual([])
  })

  it('stops the recorder through the session-init finalize', async () => {
    const screencast = new PluginScreencast({}, true)
    const recorder = fakeRecorder([frame(1, 'a')])
    const stop = vi.spyOn(recorder, 'stop')
    screencast.recorder = recorder
    screencast.sessionId = 'session-1'

    await screencast.finalize(makeCtx(screencast))

    expect(stop).toHaveBeenCalled()
    expect(screencast.recorder).toBeUndefined()
  })
})
