import { describe, expect, it } from 'vitest'

import { isAppiumSession, isNativeAppSession } from '../src/mobile.js'

/** Flags are what WDIO's own `capabilitiesEnvironmentDetector` returns for each
 *  bag — measured, because the interesting rows are where they disagree. */
const session = (
  flags: { isMobile?: boolean; isAndroid?: boolean; isIOS?: boolean },
  capabilities: Record<string, unknown>
) => ({ ...flags, capabilities }) as never

const NATIVE_ANDROID = session(
  { isMobile: true, isAndroid: true },
  {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:app': '/app.apk'
  }
)

const NATIVE_IOS = session(
  { isMobile: true, isIOS: true },
  {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:app': '/app.app'
  }
)

// WDIO reports isMobile FALSE here — its own `isMobile` excludes a
// chrome/safari/gecko/chromium automationName — while `isAndroid`, which has
// no such exclusion, reports true. That disagreement is the whole bug.
const MOBILE_WEB_ANDROID = session(
  { isMobile: false, isAndroid: true },
  {
    platformName: 'Android',
    browserName: 'Chrome',
    'appium:automationName': 'Chrome'
  }
)

const MOBILE_WEB_ANDROID_UIAUTOMATOR = session(
  { isMobile: true, isAndroid: true },
  {
    platformName: 'Android',
    browserName: 'Chrome',
    'appium:automationName': 'UiAutomator2'
  }
)

const MOBILE_WEB_IOS = session(
  { isMobile: true, isIOS: true },
  {
    platformName: 'iOS',
    browserName: 'Safari',
    'appium:automationName': 'XCUITest'
  }
)

const DESKTOP = session({}, { browserName: 'chrome' })

describe('isAppiumSession', () => {
  it('is true for every Appium session, browser or app', () => {
    // The right question for anything needing BiDi, which Appium never serves.
    expect(isAppiumSession(NATIVE_ANDROID)).toBe(true)
    expect(isAppiumSession(NATIVE_IOS)).toBe(true)
    expect(isAppiumSession(MOBILE_WEB_ANDROID)).toBe(true)
    expect(isAppiumSession(MOBILE_WEB_IOS)).toBe(true)
  })

  it('is false for a desktop session', () => {
    expect(isAppiumSession(DESKTOP)).toBe(false)
  })
})

describe('isNativeAppSession', () => {
  it('is true for a session that asked for an app', () => {
    expect(isNativeAppSession(NATIVE_ANDROID)).toBe(true)
    expect(isNativeAppSession(NATIVE_IOS)).toBe(true)
  })

  it('is false for a mobile BROWSER session, which has a real page', () => {
    expect(isNativeAppSession(MOBILE_WEB_ANDROID)).toBe(false)
    expect(isNativeAppSession(MOBILE_WEB_ANDROID_UIAUTOMATOR)).toBe(false)
    expect(isNativeAppSession(MOBILE_WEB_IOS)).toBe(false)
  })

  it('is false for a desktop session', () => {
    expect(isNativeAppSession(DESKTOP)).toBe(false)
  })

  it('is false when only a vendor bag names the browser', () => {
    // WDIO's own `isMobile` reads `bstack:options.browserName`, so bags that
    // carry it only there exist — and `isAndroid` fires on that bag's
    // `deviceName` alone, so this session has no top-level evidence at all.
    expect(
      isNativeAppSession(
        session(
          { isMobile: true, isAndroid: true },
          {
            'bstack:options': {
              deviceName: 'Google Pixel 7',
              platformName: 'Android',
              browserName: 'Chrome'
            }
          }
        )
      )
    ).toBe(false)
  })

  it('reads a blank browserName as an app', () => {
    // WDIO's own `isMobile` treats `browserName: ''` as a native signal, and a
    // driver that echoes the key rather than omitting it must not read as web.
    expect(
      isNativeAppSession(
        session(
          { isMobile: true, isAndroid: true },
          { platformName: 'Android', browserName: '   ' }
        )
      )
    ).toBe(true)
  })

  it('survives a session reporting no capabilities at all', () => {
    expect(isNativeAppSession({ isMobile: true } as never)).toBe(true)
  })
})
