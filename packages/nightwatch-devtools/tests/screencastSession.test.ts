import { describe, it, expect, vi, afterEach } from 'vitest'
import { accumulatedScreencastFrames } from '@wdio/devtools-core'
import type { ScreencastFrame } from '@wdio/devtools-shared'
import {
  needsScreencastRotation,
  rotateScreencastForSession
} from '../src/screencast-session.js'
import type { SessionInitCtx } from '../src/session-init.js'
import type { ScreencastRecorder } from '../src/screencast.js'
import type { NightwatchBrowser } from '../src/types.js'

const frame = (timestamp: number, data: string): ScreencastFrame => ({
  data,
  timestamp
})

/** Structural stand-ins: rotation reads only `frames` off the recorder and
 *  `sessionId` off the browser. */
const fakeRecorder = (frames: ScreencastFrame[]): ScreencastRecorder =>
  ({ frames, stop: async () => {} }) as unknown as ScreencastRecorder

const fakeBrowser = (sessionId: string | undefined): NightwatchBrowser =>
  ({ sessionId }) as unknown as NightwatchBrowser

/** Exactly the ctx members rotation touches — narrowed on purpose, so a
 *  rotation that starts reading a sixth one fails to compile. */
type RotationCtx = Pick<
  SessionInitCtx,
  | 'screencastOptions'
  | 'screencastRecorder'
  | 'screencastSessionId'
  | 'screencastRotation'
  | 'sessionCapturer'
  | 'finalizeCurrentScreencast'
>

/** Mirrors the plugin: `filmstripFrames` is the run buffer that ended sessions
 *  drain into, `screencastRecorder` is the live one. The real recorder is
 *  started, so the rebind is exercised end to end; polling is pushed out of the
 *  way because only its first frame matters here. */
function makeCtx(
  overrides: {
    enabled?: boolean
    recorder?: ScreencastRecorder
    sessionId?: string
  } = {}
) {
  const filmstripFrames: ScreencastFrame[] = []
  const ctx: RotationCtx = {
    screencastOptions: {
      enabled: overrides.enabled ?? true,
      pollIntervalMs: 60_000
    },
    screencastRecorder: overrides.recorder,
    screencastSessionId: overrides.sessionId,
    screencastRotation: undefined,
    sessionCapturer: {
      takeScreenshotViaHttp: async () => 'c'
    } as unknown as SessionInitCtx['sessionCapturer'],
    finalizeCurrentScreencast: vi.fn(async () => {
      if (ctx.screencastRecorder) {
        filmstripFrames.push(...ctx.screencastRecorder.frames)
      }
      ctx.screencastRecorder = undefined
      ctx.screencastSessionId = undefined
    })
  }
  live.push(ctx)
  return { ctx, filmstripFrames }
}

/** Every ctx a test built, so a started recorder's poll interval can't outlive
 *  the test that started it. */
const live: RotationCtx[] = []

afterEach(async () => {
  await Promise.all(live.splice(0).map((c) => c.screencastRecorder?.stop()))
})

const rotate = (ctx: RotationCtx, browser: NightwatchBrowser) =>
  rotateScreencastForSession(ctx as SessionInitCtx, browser)

describe('needsScreencastRotation', () => {
  it('fires when the browser reports a session the recorder is not on', () => {
    const ctx = {
      screencastRecorder: fakeRecorder([]),
      screencastSessionId: 'session-1'
    }
    expect(needsScreencastRotation(ctx, 'session-2')).toBe(true)
  })

  it('stays quiet while the session is unchanged', () => {
    const ctx = {
      screencastRecorder: fakeRecorder([]),
      screencastSessionId: 'session-1'
    }
    expect(needsScreencastRotation(ctx, 'session-1')).toBe(false)
  })

  it('never starts a recorder from nothing', () => {
    // after() finalizes the recorder BEFORE the plugin's last browser calls;
    // restarting there would strand a poll interval past teardown.
    const ctx = { screencastRecorder: undefined, screencastSessionId: 'old' }
    expect(needsScreencastRotation(ctx, 'session-2')).toBe(false)
  })

  it('waits for a live session rather than rotating into the gap', () => {
    // `browser.end()` leaves sessionId undefined until the next test creates
    // one; rotating then would stop the recorder with nowhere to restart it.
    const ctx = {
      screencastRecorder: fakeRecorder([]),
      screencastSessionId: 'session-1'
    }
    expect(needsScreencastRotation(ctx, undefined)).toBe(false)
  })
})

describe('rotateScreencastForSession', () => {
  it('carries the ended session frames into the run buffer before rebinding', async () => {
    const { ctx, filmstripFrames } = makeCtx({
      recorder: fakeRecorder([frame(1, 'a'), frame(2, 'b')]),
      sessionId: 'session-1'
    })

    rotate(ctx, fakeBrowser('session-2'))
    await ctx.screencastRotation

    // The ended session survives on the run buffer, and the combined view the
    // trace + per-test artifact paths read carries it AND the new session's.
    expect(filmstripFrames.map((f) => f.data)).toEqual(['a', 'b'])
    expect(ctx.screencastSessionId).toBe('session-2')
    expect(
      accumulatedScreencastFrames(filmstripFrames, ctx.screencastRecorder).map(
        (f) => f.data
      )
    ).toEqual(['a', 'b', 'c'])
  })

  it('rotates once while a rotation is still in flight', async () => {
    const { ctx } = makeCtx({
      recorder: fakeRecorder([frame(1, 'a')]),
      sessionId: 'session-1'
    })

    // Commands fire far faster than a rotation completes; unlatched, a second
    // pass would tear down the recorder the first one just started.
    rotate(ctx, fakeBrowser('session-2'))
    rotate(ctx, fakeBrowser('session-2'))
    rotate(ctx, fakeBrowser('session-2'))
    await ctx.screencastRotation

    expect(ctx.finalizeCurrentScreencast).toHaveBeenCalledTimes(1)
  })

  it('leaves a drain handle teardown can await, then clears it', async () => {
    const { ctx } = makeCtx({
      recorder: fakeRecorder([frame(1, 'a')]),
      sessionId: 'session-1'
    })

    rotate(ctx, fakeBrowser('session-2'))
    expect(ctx.screencastRotation).toBeInstanceOf(Promise)
    await ctx.screencastRotation
    expect(ctx.screencastRotation).toBeUndefined()
  })

  it('does nothing when the screencast is off', () => {
    const { ctx } = makeCtx({
      enabled: false,
      recorder: fakeRecorder([frame(1, 'a')]),
      sessionId: 'session-1'
    })
    rotate(ctx, fakeBrowser('session-2'))
    expect(ctx.finalizeCurrentScreencast).not.toHaveBeenCalled()
  })

  it('leaves a recorder alone while its session is still current', () => {
    const { ctx } = makeCtx({
      recorder: fakeRecorder([frame(1, 'a')]),
      sessionId: 'session-1'
    })
    rotate(ctx, fakeBrowser('session-1'))
    expect(ctx.finalizeCurrentScreencast).not.toHaveBeenCalled()
  })
})
