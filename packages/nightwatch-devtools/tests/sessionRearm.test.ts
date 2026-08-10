import { describe, it, expect, vi, afterEach } from 'vitest'
import type * as DevToolsCore from '@wdio/devtools-core'
import {
  needsCaptureRearm,
  rearmCaptureForSession
} from '../src/session-init.js'
import type { SessionInitCtx } from '../src/session-init.js'
import type { NightwatchBrowser } from '../src/types.js'

const registerCollectorPreload = vi.hoisted(() =>
  vi.fn(async () => true as boolean)
)

vi.mock('@wdio/devtools-core', async (importOriginal) => ({
  ...(await importOriginal<typeof DevToolsCore>()),
  registerCollectorPreload
}))

const attachBidiHandlers = vi.hoisted(() => vi.fn(async () => true as boolean))

vi.mock('../src/bidi.js', () => ({
  attachBidiHandlers,
  buildBidiSinks: () => ({})
}))

/** A session change is only visible through the browser: Nightwatch raises no
 *  event, and `end` is never wrapped. `driver` is what both channels attach to. */
const fakeBrowser = (sessionId: string | undefined): NightwatchBrowser =>
  ({ sessionId, driver: { id: sessionId } }) as unknown as NightwatchBrowser

/** Exactly the ctx members the re-arm touches — narrowed on purpose, so a
 *  re-arm that starts reading a fifth one fails to compile. */
type RearmCtx = Pick<
  SessionInitCtx,
  'armedSessionId' | 'sessionCapturer' | 'bidiEnabled' | 'lastSessionId'
>

/** Stands in for the accumulated trace state a re-arm must leave alone. */
interface FakeCapturer {
  preloadRegistered: boolean
  bidiActive: boolean
  commandsLog: unknown[]
  consoleLogs: unknown[]
  networkRequests: unknown[]
}

function makeCtx(
  overrides: { armedSessionId?: string; bidiEnabled?: boolean } = {}
) {
  const capturer: FakeCapturer = {
    preloadRegistered: true,
    bidiActive: true,
    commandsLog: ['cmd-1', 'cmd-2'],
    consoleLogs: ['log-1'],
    networkRequests: ['req-1']
  }
  const ctx: RearmCtx = {
    armedSessionId: overrides.armedSessionId ?? 'session-1',
    bidiEnabled: overrides.bidiEnabled ?? true,
    lastSessionId: 'session-1',
    sessionCapturer: capturer as unknown as SessionInitCtx['sessionCapturer']
  }
  return { ctx, capturer }
}

const rearm = (ctx: RearmCtx, browser: NightwatchBrowser) =>
  rearmCaptureForSession(ctx as SessionInitCtx, browser)

/** The re-arm is fire-and-forget by design — and its BiDi step crosses a
 *  dynamic `import()` — so a test that asserts on its outcome, or an afterEach
 *  that resets the mocks it calls, has to drain the ticks it left behind. */
const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

afterEach(async () => {
  await settle()
  registerCollectorPreload.mockClear()
  registerCollectorPreload.mockResolvedValue(true)
  attachBidiHandlers.mockClear()
  attachBidiHandlers.mockResolvedValue(true)
})

describe('needsCaptureRearm', () => {
  it('fires when a command runs under a session that was never armed', () => {
    expect(
      needsCaptureRearm(
        { armedSessionId: 'session-1', sessionCapturer: {} as never },
        'session-2'
      )
    ).toBe(true)
  })

  it('stays quiet while the armed session is still current', () => {
    expect(
      needsCaptureRearm(
        { armedSessionId: 'session-1', sessionCapturer: {} as never },
        'session-1'
      )
    ).toBe(false)
  })

  it('never arms from nothing', () => {
    // Before bringup there is no capturer to arm onto, and
    // ensureSessionInitialized owns that first arm.
    expect(
      needsCaptureRearm(
        { armedSessionId: undefined, sessionCapturer: {} as never },
        'session-1'
      )
    ).toBe(false)
  })

  it('waits for a live session rather than arming into the gap', () => {
    // `browser.end()` leaves sessionId undefined until the next testcase
    // creates one; there is no BiDi channel to register against yet.
    expect(
      needsCaptureRearm(
        { armedSessionId: 'session-1', sessionCapturer: {} as never },
        undefined
      )
    ).toBe(false)
  })

  it('stays quiet while the capturer is being rebuilt', () => {
    expect(
      needsCaptureRearm(
        {
          armedSessionId: 'session-1',
          sessionCapturer: undefined as never
        },
        'session-2'
      )
    ).toBe(false)
  })
})

describe('rearmCaptureForSession', () => {
  it('re-attaches BiDi and re-registers the preload for the new session', async () => {
    // The gap this closes: both used to happen once, at bringup, so every
    // session after a mid-run `browser.end()` ran with neither.
    const { ctx, capturer } = makeCtx()

    rearm(ctx, fakeBrowser('session-2'))
    await settle()

    expect(attachBidiHandlers).toHaveBeenCalledTimes(1)
    expect(registerCollectorPreload).toHaveBeenCalledTimes(1)
    expect(capturer.preloadRegistered).toBe(true)
    expect(capturer.bidiActive).toBe(true)
    expect(ctx.armedSessionId).toBe('session-2')
  })

  it('leaves the accumulated capture state untouched', async () => {
    // Deliberately narrower than handleSessionChange, which rebuilds the
    // SessionCapturer and in trace mode drops the whole run so far.
    const { ctx, capturer } = makeCtx()
    const capturerRef = ctx.sessionCapturer

    rearm(ctx, fakeBrowser('session-2'))
    await settle()

    expect(ctx.sessionCapturer).toBe(capturerRef)
    expect(capturer.commandsLog).toEqual(['cmd-1', 'cmd-2'])
    expect(capturer.consoleLogs).toEqual(['log-1'])
    expect(capturer.networkRequests).toEqual(['req-1'])
    // ensureSessionInitialized's own bookkeeping stays its own.
    expect(ctx.lastSessionId).toBe('session-1')
  })

  it('arms once while the arm is still in flight', async () => {
    // Commands fire far faster than a BiDi handshake completes; unlatched,
    // every command of the new session would register another preload.
    const { ctx } = makeCtx()

    rearm(ctx, fakeBrowser('session-2'))
    rearm(ctx, fakeBrowser('session-2'))
    rearm(ctx, fakeBrowser('session-2'))
    await settle()

    expect(registerCollectorPreload).toHaveBeenCalledTimes(1)
  })

  it('drops the dead session claims at detection, before the new ones land', () => {
    // anchorAfterNavigation stands its settle poll down when the preload is
    // registered, and captureNetworkFromPerformanceLogs stands down when BiDi
    // is active — between sessions neither claim is true any more.
    const { ctx, capturer } = makeCtx()

    rearm(ctx, fakeBrowser('session-2'))

    expect(capturer.preloadRegistered).toBe(false)
    expect(capturer.bidiActive).toBe(false)
  })

  it('leaves the perf-log network path open when BiDi cannot be re-attached', async () => {
    // A stale bidiActive gates perf-log capture off behind inspectors bound to
    // a session that is gone, which is zero network capture for the rest of the
    // run rather than a degraded stream.
    attachBidiHandlers.mockResolvedValue(false)
    const { ctx, capturer } = makeCtx()

    rearm(ctx, fakeBrowser('session-2'))
    await settle()

    expect(capturer.bidiActive).toBe(false)
  })

  it('degrades to the `<script>` path when the session carries no BiDi', async () => {
    // No `webSocketUrl: true` → the script manager throws and the helper
    // reports false; the per-document injection stays the capture path.
    registerCollectorPreload.mockResolvedValue(false)
    const { ctx, capturer } = makeCtx()

    rearm(ctx, fakeBrowser('session-2'))
    await settle()

    expect(capturer.preloadRegistered).toBe(false)
    expect(ctx.armedSessionId).toBe('session-2')
  })

  it('registers the preload even with the bidi option off', async () => {
    // The preload needs only a session created with `webSocketUrl: true`;
    // gating it on the console/network opt-in would leave the navigation race
    // in place for nearly every user.
    const { ctx, capturer } = makeCtx({ bidiEnabled: false })

    rearm(ctx, fakeBrowser('session-2'))
    await settle()

    expect(attachBidiHandlers).not.toHaveBeenCalled()
    expect(registerCollectorPreload).toHaveBeenCalledTimes(1)
    expect(capturer.preloadRegistered).toBe(true)
  })

  it('survives a registration that throws', async () => {
    registerCollectorPreload.mockRejectedValue(new Error('ws closed'))
    const { ctx } = makeCtx()

    expect(() => rearm(ctx, fakeBrowser('session-2'))).not.toThrow()
    await settle()

    // Armed all the same: one attempt per session, matching bringup.
    expect(ctx.armedSessionId).toBe('session-2')
  })

  it('does nothing while the armed session is still current', () => {
    const { ctx } = makeCtx()
    rearm(ctx, fakeBrowser('session-1'))
    expect(registerCollectorPreload).not.toHaveBeenCalled()
  })
})
