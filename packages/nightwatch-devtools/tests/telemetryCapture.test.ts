import { describe, it, expect, vi, afterEach } from 'vitest'
import type * as DevToolsCore from '@wdio/devtools-core'
import { SessionCapturer } from '../src/session.js'
import { BrowserProxy } from '../src/helpers/browserProxy.js'
import { ensureSessionInitialized } from '../src/session-init.js'
import type { SessionInitCtx } from '../src/session-init.js'
import type { TestManager } from '../src/helpers/testManager.js'
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

vi.mock('../src/screencast-session.js', () => ({
  startScreencast: vi.fn(async () => {}),
  rotateScreencastForSession: vi.fn()
}))

/** Any touch of the browser fails the test: telemetry must not reach the page or the driver. */
function untouchableBrowser(): NightwatchBrowser {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(`browser touched: ${String(prop)}`)
      }
    }
  ) as unknown as NightwatchBrowser
}

function sessionBrowser(sessionId: string) {
  return {
    sessionId,
    driver: { id: sessionId },
    capabilities: { browserName: 'chrome' },
    desiredCapabilities: {},
    options: {},
    execute: vi.fn(async () => null)
  }
}

afterEach(() => {
  registerCollectorPreload.mockClear()
  attachBidiHandlers.mockClear()
})

describe('telemetry mode reads nothing from the browser on the capture paths', () => {
  it('injects no collector, drains no page and reads no perf log', async () => {
    const capturer = new SessionCapturer({}, untouchableBrowser())
    capturer.traceMode = 'telemetry'
    const browser = untouchableBrowser()

    await expect(capturer.injectScript(browser)).resolves.toBeUndefined()
    await expect(capturer.captureTrace(browser, true)).resolves.toBeUndefined()
    await expect(
      capturer.captureTraceAtTestEnd(browser)
    ).resolves.toBeUndefined()
    await expect(
      capturer.anchorAfterNavigation(browser, 1)
    ).resolves.toBeUndefined()
    await expect(
      capturer.captureNetworkFromPerformanceLogs(browser)
    ).resolves.toBeUndefined()
  })
})

describe('telemetry session bringup', () => {
  it('registers no preload, attaches no BiDi, reads no viewport and patches no console or stdout', async () => {
    const browser = sessionBrowser('session-1')
    const ctx = {
      hostname: 'localhost',
      port: 3000,
      screencastOptions: {},
      bidiEnabled: true,
      mode: 'telemetry',
      captureAssertions: false,
      runner: 'nightwatch-bdd',
      testReporter: { updateSuites: vi.fn(), updateUpstream: vi.fn() },
      browserProxy: {},
      isScriptInjected: true,
      lastSessionId: undefined,
      armedSessionId: undefined,
      srcFolders: [],
      screencastRecorder: undefined,
      screencastSessionId: undefined,
      screencastRotation: undefined,
      configPath: undefined,
      getCurrentTest: () => null,
      getCurrentScenarioSuite: () => null,
      buildMetadataOptions: () => ({}),
      attemptFor: () => undefined,
      recordOutcome: () => {},
      finalizeCurrentScreencast: vi.fn(async () => {})
    } as unknown as SessionInitCtx

    const write = process.stdout.write
    const log = console.log
    await ensureSessionInitialized(ctx, browser as unknown as NightwatchBrowser)

    expect([process.stdout.write, console.log]).toEqual([write, log])
    expect(registerCollectorPreload).not.toHaveBeenCalled()
    expect(attachBidiHandlers).not.toHaveBeenCalled()
    expect(browser.execute).not.toHaveBeenCalled()
    expect(ctx.sessionCapturer?.metadata?.sessionId).toBe('session-1')
  })
})

describe('telemetry command wrapper', () => {
  it('passes commands through without recording rows or navigation hooks', () => {
    const click = vi.fn((_selector: string) => 'clicked')
    const url = vi.fn((_href: string) => 'navigated')
    const browser = { sessionId: 'session-1', click, url }
    const capturer = {
      traceMode: 'telemetry',
      captureCommand: vi.fn(),
      openCommand: vi.fn(),
      commandsLog: []
    }
    const testManager = {
      detectTestBoundary: vi.fn(),
      startTestIfPending: vi.fn()
    }
    const proxy = new BrowserProxy(
      capturer as unknown as SessionCapturer,
      testManager as unknown as TestManager,
      () => null
    )

    proxy.wrapUrlMethod(browser as unknown as NightwatchBrowser)
    proxy.wrapBrowserCommands(browser as unknown as NightwatchBrowser)

    expect(browser.click('#submit')).toBe('clicked')
    expect(click).toHaveBeenCalledWith('#submit')
    expect(browser.url('https://example.test/')).toBe('navigated')
    expect(url).toHaveBeenCalledWith('https://example.test/')
    expect(capturer.captureCommand).not.toHaveBeenCalled()
    expect(capturer.openCommand).not.toHaveBeenCalled()
    expect(testManager.startTestIfPending).toHaveBeenCalled()
  })
})
