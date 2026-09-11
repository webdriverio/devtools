import { describe, it, expect, vi, beforeEach } from 'vitest'

import { captureActionSnapshot } from '../src/action-snapshot.js'
import { SessionCapturer } from '../src/session.js'
import { webdriverExecute, webdriverGet } from '../src/helpers/webdriverHttp.js'
import type { NightwatchBrowser } from '../src/types.js'

// The page-side calls all go over raw WebDriver HTTP to stay off Nightwatch's
// command queue, so the transport is what a native guard has to leave alone.
vi.mock('../src/helpers/webdriverHttp.js', () => ({
  resolveWebDriverAddress: () => ({ host: 'localhost', port: 4444 }),
  webdriverGet: vi.fn(async () => null),
  webdriverPost: vi.fn(async () => null),
  webdriverExecute: vi.fn(async () => null)
}))

/**
 * A native app has no document, so the drain, the injection and the
 * document-replacement poll are round trips that can only fail. Read off the
 * capabilities `session-init` already published as metadata.
 */
describe('nightwatch SessionCapturer on a native session', () => {
  const NATIVE = {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:app': '/app.apk'
  }
  const MOBILE_WEB = {
    platformName: 'Android',
    browserName: 'chrome',
    'appium:automationName': 'UiAutomator2'
  }

  const browser = () =>
    ({
      sessionId: 'sess-1',
      capabilities: {},
      execute: vi.fn(async () => ({ value: null })),
      options: { webdriver: { host: 'localhost', port: 4444 } }
    }) as unknown as NightwatchBrowser

  const capturerWith = (capabilities: Record<string, unknown>) => {
    const cap = new SessionCapturer({}, browser())
    cap.metadata = { capabilities } as never
    return cap
  }

  beforeEach(() => {
    vi.mocked(webdriverExecute).mockClear()
    vi.mocked(webdriverGet).mockClear()
  })

  it('reports itself native from the published capabilities', () => {
    expect(capturerWith(NATIVE).isNativeAppSession).toBe(true)
    expect(capturerWith(MOBILE_WEB).isNativeAppSession).toBe(false)
  })

  it('makes no page call from captureTrace', async () => {
    await capturerWith(NATIVE).captureTrace(browser(), true)
    expect(webdriverExecute).not.toHaveBeenCalled()
  })

  it('makes none from injectScript or anchorAfterNavigation', async () => {
    const cap = capturerWith(NATIVE)
    const b = browser()

    await cap.injectScript(b)
    await cap.anchorAfterNavigation(b)

    expect(webdriverExecute).not.toHaveBeenCalled()
  })

  it('still drains a phone running a browser', async () => {
    await capturerWith(MOBILE_WEB).captureTrace(browser(), true)
    expect(webdriverExecute).toHaveBeenCalled()
  })
})

/**
 * The per-action snapshot is the densest page-script path there is: an injected
 * script plus url and title, on every action. The screenshot is the one probe a
 * native app still serves.
 */
describe('nightwatch per-action snapshot on a native session', () => {
  const browser = () =>
    ({
      sessionId: 'sess-1',
      capabilities: {},
      options: { webdriver: { host: 'localhost', port: 4444 } }
    }) as unknown as NightwatchBrowser

  beforeEach(() => {
    vi.mocked(webdriverExecute).mockClear()
    vi.mocked(webdriverGet).mockClear()
  })

  it('takes the screenshot and makes no page read', async () => {
    await captureActionSnapshot(browser(), 'click', 1, undefined, true)

    expect(webdriverExecute).not.toHaveBeenCalled()
    const paths = vi.mocked(webdriverGet).mock.calls.map(([, path]) => path)
    expect(paths).toEqual(['screenshot'])
  })

  it('reads the page for a session that has one', async () => {
    await captureActionSnapshot(browser(), 'click', 1, undefined, false)

    expect(webdriverExecute).toHaveBeenCalled()
    const paths = vi.mocked(webdriverGet).mock.calls.map(([, path]) => path)
    expect(paths).toContain('url')
    expect(paths).toContain('title')
  })
})
