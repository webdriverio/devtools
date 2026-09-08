import { describe, expect, it, vi } from 'vitest'

import { resolveSessionMetadata } from '../src/session-metadata.js'
import { TraceType } from '../src/types.js'

/**
 * A native session answers `getWindowSize` and nothing DOM-shaped; a desktop
 * one answers `execute`. The flags are what `isAppiumSession` narrows on.
 */
function browserDouble(overrides: Record<string, unknown> = {}) {
  return {
    capabilities: {},
    options: { hostname: 'localhost' },
    execute: vi.fn().mockResolvedValue({
      width: 1280,
      height: 720,
      offsetLeft: 0,
      offsetTop: 0,
      scale: 1
    }),
    getWindowSize: vi.fn().mockResolvedValue({ width: 1080, height: 2219 }),
    ...overrides
  } as unknown as WebdriverIO.Browser
}

const NATIVE_CAPS = {
  platformName: 'Android',
  deviceName: '28111FDH200CUX',
  udid: '28111FDH200CUX',
  deviceModel: 'Pixel 7',
  platformVersion: '14'
}

describe('resolveSessionMetadata', () => {
  it("reads a page's own visual viewport on desktop", async () => {
    const browser = browserDouble({ capabilities: { browserName: 'chrome' } })

    const metadata = await resolveSessionMetadata(browser, TraceType.Testrunner)

    expect(metadata.viewport).toEqual({
      width: 1280,
      height: 720,
      offsetLeft: 0,
      offsetTop: 0,
      scale: 1
    })
    expect(metadata.capabilities).toEqual({ browserName: 'chrome' })
    expect(metadata.device).toBeUndefined()
    expect(browser.getWindowSize).not.toHaveBeenCalled()
  })

  /**
   * The measurement in #345: the session was skipped entirely because it reads
   * `window.visualViewport` and a native app has no DOM, so the zip fell back
   * to the exporter's 1280x720. `getWindowSize` answers 1080x2219 on a Pixel 7.
   */
  it('reads the window off the driver on a native session', async () => {
    const browser = browserDouble({
      isMobile: true,
      isAndroid: true,
      capabilities: NATIVE_CAPS
    })

    const metadata = await resolveSessionMetadata(browser, TraceType.Testrunner)

    expect(metadata.viewport).toEqual({
      width: 1080,
      height: 2219,
      offsetLeft: 0,
      offsetTop: 0,
      scale: 1
    })
    // Never asked to run script in a session that has no DOM to run it in.
    expect(browser.execute).not.toHaveBeenCalled()
  })

  /**
   * A mobile BROWSER session has a page, and the player sizes the DOM-replay
   * iframe from this viewport — so reading the driver window here would frame
   * the replay at the window including browser chrome, at a hardcoded scale of
   * 1. `window.visualViewport` is the only source carrying the real scale.
   */
  it("reads the page's own viewport on an Appium browser session", async () => {
    const browser = browserDouble({
      isMobile: false,
      isAndroid: true,
      capabilities: {
        platformName: 'Android',
        browserName: 'Chrome',
        'appium:automationName': 'Chrome'
      }
    })

    const metadata = await resolveSessionMetadata(browser, TraceType.Testrunner)

    expect(metadata.viewport).toEqual({
      width: 1280,
      height: 720,
      offsetLeft: 0,
      offsetTop: 0,
      scale: 1
    })
    expect(browser.getWindowSize).not.toHaveBeenCalled()
  })

  it('states the device a native session reports', async () => {
    const browser = browserDouble({
      isMobile: true,
      capabilities: NATIVE_CAPS
    })

    const metadata = await resolveSessionMetadata(browser, TraceType.Testrunner)

    expect(metadata.device).toEqual({
      platform: 'android',
      name: 'Pixel 7',
      version: '14'
    })
  })

  it('keeps the rest of the metadata when the viewport cannot be read', async () => {
    const browser = browserDouble({
      isMobile: true,
      capabilities: NATIVE_CAPS,
      getWindowSize: vi.fn().mockRejectedValue(new Error('no such session'))
    })

    const metadata = await resolveSessionMetadata(browser, TraceType.Testrunner)

    // Descriptive, not load-bearing: the capture is still worth keeping.
    expect('viewport' in metadata).toBe(false)
    expect(metadata.device?.name).toBe('Pixel 7')
    expect(metadata.type).toBe(TraceType.Testrunner)
  })

  it('omits a viewport a desktop page answered as null', async () => {
    const browser = browserDouble({
      capabilities: { browserName: 'chrome' },
      execute: vi.fn().mockResolvedValue(null)
    })

    const metadata = await resolveSessionMetadata(browser, TraceType.Testrunner)

    expect('viewport' in metadata).toBe(false)
  })

  it('carries the capture type and the session options through', async () => {
    const metadata = await resolveSessionMetadata(
      browserDouble(),
      TraceType.Standalone
    )

    expect(metadata.type).toBe(TraceType.Standalone)
    expect(metadata.options).toEqual({ hostname: 'localhost' })
  })
})
