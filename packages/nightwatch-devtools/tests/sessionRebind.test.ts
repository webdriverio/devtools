import { describe, it, expect, vi, afterEach } from 'vitest'
import type * as DevToolsCore from '@wdio/devtools-core'
import { ensureSessionInitialized } from '../src/session-init.js'
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

const startScreencast = vi.hoisted(() => vi.fn(async () => {}))
const rotateScreencastForSession = vi.hoisted(() => vi.fn())

vi.mock('../src/screencast-session.js', () => ({
  startScreencast,
  rotateScreencastForSession
}))

const fakeBrowser = (sessionId: string): NightwatchBrowser =>
  ({
    sessionId,
    driver: { id: sessionId },
    capabilities: { browserName: 'chrome' },
    desiredCapabilities: {},
    options: {}
  }) as unknown as NightwatchBrowser

/** Stands in for the run's one capturer: the accumulators a replaced session
 *  must not reset, plus the single field that IS session-bound. */
function makeCapturer() {
  return {
    browser: undefined as NightwatchBrowser | undefined,
    setBrowser(browser: NightwatchBrowser) {
      this.browser = browser
    },
    preloadRegistered: true,
    bidiActive: true,
    metadata: undefined as unknown,
    commandsLog: ['cmd-1', 'cmd-2'],
    consoleLogs: ['log-1'],
    networkRequests: ['req-1'],
    mutations: ['mut-1'],
    traceLogs: [],
    actionSnapshots: ['snap-1'],
    sendUpstream: vi.fn()
  }
}

function makeCtx(overrides: { armedSessionId?: string } = {}) {
  const capturer = makeCapturer()
  const ctx = {
    hostname: 'localhost',
    port: 3000,
    screencastOptions: { enabled: true },
    bidiEnabled: true,
    mode: 'trace',
    captureAssertions: true,
    runner: 'nightwatch-cucumber',
    sessionCapturer: capturer,
    testReporter: { updateSuites: vi.fn(), updateUpstream: vi.fn() },
    browserProxy: {},
    isScriptInjected: true,
    lastSessionId: 'session-1',
    armedSessionId: overrides.armedSessionId ?? 'session-1',
    srcFolders: [],
    screencastRecorder: undefined,
    screencastSessionId: 'session-1',
    screencastRotation: undefined,
    configPath: undefined,
    getCurrentTest: () => null,
    getCurrentScenarioSuite: () => null,
    buildMetadataOptions: () => ({}),
    attemptFor: () => undefined,
    recordOutcome: () => {},
    finalizeCurrentScreencast: vi.fn(async () => {})
  } as unknown as SessionInitCtx
  return { ctx, capturer }
}

afterEach(() => {
  registerCollectorPreload.mockClear()
  registerCollectorPreload.mockResolvedValue(true)
  attachBidiHandlers.mockClear()
  attachBidiHandlers.mockResolvedValue(true)
  startScreencast.mockClear()
  rotateScreencastForSession.mockClear()
  rotateScreencastForSession.mockImplementation(() => {})
})

describe('ensureSessionInitialized — session replaced mid-run', () => {
  it('keeps the run capturer and everything it has accumulated', async () => {
    const { ctx, capturer } = makeCtx()

    await ensureSessionInitialized(ctx, fakeBrowser('session-2'))

    expect(ctx.sessionCapturer).toBe(capturer as unknown)
    expect(capturer.commandsLog).toEqual(['cmd-1', 'cmd-2'])
    expect(capturer.consoleLogs).toEqual(['log-1'])
    expect(capturer.networkRequests).toEqual(['req-1'])
    expect(capturer.mutations).toEqual(['mut-1'])
    expect(capturer.actionSnapshots).toEqual(['snap-1'])
  })

  it('re-targets the capturer at the new browser object', async () => {
    // Cucumber hands over a fresh browser per scenario; the stale one answers
    // neither the perf capture nor the per-action snapshot probe.
    const { ctx, capturer } = makeCtx()
    const browser = fakeBrowser('session-2')

    await ensureSessionInitialized(ctx, browser)

    expect(capturer.browser).toBe(browser)
  })

  it('re-arms the capture channels for the new session', async () => {
    const { ctx, capturer } = makeCtx()

    await ensureSessionInitialized(ctx, fakeBrowser('session-2'))

    expect(registerCollectorPreload).toHaveBeenCalledTimes(1)
    expect(attachBidiHandlers).toHaveBeenCalledTimes(1)
    expect(capturer.preloadRegistered).toBe(true)
    expect(capturer.bidiActive).toBe(true)
    expect(ctx.armedSessionId).toBe('session-2')
  })

  it('rotates the screencast through the latched helper, never by hand', async () => {
    // Hand-rolling finalize+start here would run a second, unlatched rotation
    // alongside the one the command hook can start for the same replacement.
    const { ctx } = makeCtx()
    const browser = fakeBrowser('session-2')

    await ensureSessionInitialized(ctx, browser)

    expect(rotateScreencastForSession).toHaveBeenCalledWith(ctx, browser)
    expect(startScreencast).not.toHaveBeenCalled()
  })

  it('waits for the rotation it started', async () => {
    // The rotation drains the dying session's frames into the run buffer;
    // returning before it settles races the next scenario's first command.
    const { ctx } = makeCtx()
    let release = () => {}
    const rotationStarted = new Promise<void>((started) => {
      rotateScreencastForSession.mockImplementation(() => {
        ctx.screencastRotation = new Promise<void>((resolve) => {
          release = resolve
        })
        started()
      })
    })
    let settled = false

    const pending = ensureSessionInitialized(
      ctx,
      fakeBrowser('session-2')
    ).then(() => {
      settled = true
    })
    await rotationStarted
    await Promise.resolve()
    expect(settled).toBe(false)

    release()
    await pending
    expect(settled).toBe(true)
  })

  it('does not re-arm a session the command hook already armed', async () => {
    // A mid-module `browser.end()` arms session-2 from the command hook; the
    // next module's beforeEach still sees lastSessionId === session-1. Arming
    // again would drop the live claims back to the `<script>` fallback while
    // the first arm is still in flight.
    const { ctx, capturer } = makeCtx({ armedSessionId: 'session-2' })

    await ensureSessionInitialized(ctx, fakeBrowser('session-2'))

    expect(registerCollectorPreload).not.toHaveBeenCalled()
    expect(attachBidiHandlers).not.toHaveBeenCalled()
    expect(capturer.preloadRegistered).toBe(true)
    expect(capturer.bidiActive).toBe(true)
  })

  it('re-broadcasts metadata for the new session', async () => {
    const { ctx, capturer } = makeCtx()

    await ensureSessionInitialized(ctx, fakeBrowser('session-2'))

    expect(capturer.metadata).toMatchObject({ sessionId: 'session-2' })
    expect(capturer.sendUpstream).toHaveBeenCalledWith(
      'metadata',
      expect.objectContaining({ sessionId: 'session-2' })
    )
  })

  it('reopens the url-method wrapping for the new browser object', async () => {
    // `isScriptInjected` also gates wrapUrlMethod, which is per browser OBJECT
    // — left set, the new object's navigations are never instrumented.
    const { ctx } = makeCtx()

    await ensureSessionInitialized(ctx, fakeBrowser('session-2'))

    expect(ctx.isScriptInjected).toBe(false)
  })

  it('does no session work when the same session comes back around', async () => {
    // The per-test path re-enters on every test; only a replaced session is a
    // rebind.
    const { ctx, capturer } = makeCtx()

    await ensureSessionInitialized(ctx, fakeBrowser('session-1'))

    expect(registerCollectorPreload).not.toHaveBeenCalled()
    expect(rotateScreencastForSession).not.toHaveBeenCalled()
    expect(capturer.preloadRegistered).toBe(true)
    expect(ctx.isScriptInjected).toBe(true)
  })
})
