import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reportCaptureTiming } from '@wdio/devtools-core'
import {
  CAPTURE_TIMING_ENV,
  type CaptureTimingRecord
} from '@wdio/devtools-shared'

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

  it('drains the native network proxy from captureTrace, throttled per command', async () => {
    const cap = capturerWith(NATIVE)
    const forward = vi.spyOn(cap.nativeNetwork, 'forward')
    await cap.captureTrace(browser(), true)
    expect(forward).toHaveBeenCalledWith({ throttle: true })
  })

  // afterEach and the cucumber pre-quit hook run this before the slice flush.
  it('drains unthrottled at a test end, ahead of the test slice', async () => {
    const cap = capturerWith(NATIVE)
    const forward = vi.spyOn(cap.nativeNetwork, 'forward')
    await cap.captureTraceAtTestEnd(browser())
    expect(forward).toHaveBeenCalledWith()
    expect(webdriverExecute).not.toHaveBeenCalled()
  })

  it('drains the page with an anchor at a web test end', async () => {
    await capturerWith(MOBILE_WEB).captureTraceAtTestEnd(browser())
    expect(webdriverExecute).toHaveBeenCalled()
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
 * A native app serves no page script, url or title, so the screenshot and the
 * page-source XML are the only probes; core builds the element list and the
 * accessibility tree from the XML.
 */
describe('nightwatch per-action snapshot on a native session', () => {
  const ANDROID_SOURCE = `<hierarchy>
  <android.widget.FrameLayout bounds="[0,0][1080,2424]">
    <android.widget.Button clickable="true" content-desc="Start" text="Start" bounds="[100,200][400,300]"/>
  </android.widget.FrameLayout>
</hierarchy>`
  const IOS_SOURCE = `<XCUIElementTypeApplication name="Settings" label="Settings" x="0" y="0" width="402" height="874">
  <XCUIElementTypeButton name="General" label="General" enabled="true" visible="true" accessible="true" x="0" y="100" width="402" height="44"/>
</XCUIElementTypeApplication>`

  const browser = () =>
    ({
      sessionId: 'sess-1',
      capabilities: {},
      options: { webdriver: { host: 'localhost', port: 4444 } }
    }) as unknown as NightwatchBrowser

  const serving = (source: string) =>
    vi
      .mocked(webdriverGet)
      .mockImplementation(((_browser: NightwatchBrowser, path: string) =>
        Promise.resolve(
          path === 'source' ? source : path === 'screenshot' ? 'AA' : null
        )) as unknown as typeof webdriverGet)

  beforeEach(() => {
    vi.mocked(webdriverExecute).mockClear()
    vi.mocked(webdriverGet).mockReset()
    vi.mocked(webdriverGet).mockResolvedValue(null)
  })

  it('reads the page source and the screenshot, and makes no page read', async () => {
    await captureActionSnapshot(browser(), 'click', 1, undefined, {
      platform: 'android'
    })

    expect(webdriverExecute).not.toHaveBeenCalled()
    const paths = vi.mocked(webdriverGet).mock.calls.map(([, path]) => path)
    expect(paths).toEqual(['source', 'screenshot'])
  })

  it('builds the element list and accessibility tree from an Android page source', async () => {
    serving(ANDROID_SOURCE)
    const snap = await captureActionSnapshot(browser(), 'click', 1, undefined, {
      platform: 'android'
    })

    expect(snap?.screenshot).toBe('AA')
    expect(snap?.snapshotText).toContain('[android]')
    expect(snap?.snapshotText).toContain('button "Start"')
    expect(snap?.elements?.length).toBeGreaterThan(0)
  })

  it('reads an iOS page source as iOS', async () => {
    serving(IOS_SOURCE)
    const snap = await captureActionSnapshot(browser(), 'click', 1, undefined, {
      platform: 'ios'
    })

    expect(snap?.snapshotText).toContain('[ios]')
    expect(snap?.snapshotText).toContain('General')
    expect(snap?.elements?.length).toBeGreaterThan(0)
  })

  it('passes the session platform from the capturer to the capture', async () => {
    serving(IOS_SOURCE)
    const cap = new SessionCapturer({}, browser())
    try {
      cap.traceMode = 'trace'
      cap.metadata = {
        capabilities: {
          platformName: 'iOS',
          'appium:automationName': 'XCUITest',
          'appium:app': '/Settings.app'
        }
      } as never
      await cap.captureCommand('click', [], null, undefined, { timestamp: 7 })
      await Promise.all(cap.snapshotCaptures)

      expect(cap.actionSnapshots[0]?.snapshotText).toContain('[ios]')
      expect(cap.actionSnapshots[0]?.elements?.length).toBeGreaterThan(0)
    } finally {
      cap.cleanup()
    }
  })

  it('reports the capture as native, with the page-source probe timed', async () => {
    serving(ANDROID_SOURCE)
    vi.stubEnv(CAPTURE_TIMING_ENV, '1')
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-native-timing-'))
    try {
      await captureActionSnapshot(browser(), 'click', 1, undefined, {
        platform: 'android'
      })
      const file = await reportCaptureTiming(outDir, () => undefined)
      const [record] = fs
        .readFileSync(file!, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as CaptureTimingRecord)

      expect(record?.native).toBe(true)
      expect(record?.probes.map((p) => p.probe)).toEqual([
        'pageSource',
        'screenshot',
        'process'
      ])
    } finally {
      vi.unstubAllEnvs()
      fs.rmSync(outDir, { recursive: true, force: true })
    }
  })

  it('reads the page for a session that has one', async () => {
    await captureActionSnapshot(browser(), 'click', 1, undefined)

    expect(webdriverExecute).toHaveBeenCalled()
    const paths = vi.mocked(webdriverGet).mock.calls.map(([, path]) => path)
    expect(paths).toContain('url')
    expect(paths).toContain('title')
    expect(paths).not.toContain('source')
  })
})
