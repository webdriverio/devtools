import { describe, expect, it } from 'vitest'

import { isAppiumSession } from '../src/mobile.js'

/**
 * `isAppiumSession` answers "can this session serve WebDriver BiDi", and
 * Appium cannot — whether it drives an app or a browser. Whether the session
 * has a DOCUMENT is a different question, answered from capabilities by
 * shared's `isNativeAppSession` (see packages/shared/tests/device.test.ts).
 *
 * Flags are what WDIO's own `capabilitiesEnvironmentDetector` returns for each
 * bag — measured, because the interesting rows are where they disagree.
 */
const session = (flags: {
  isMobile?: boolean
  isAndroid?: boolean
  isIOS?: boolean
}) => flags as never

describe('isAppiumSession', () => {
  it('is true for every Appium session, browser or app', () => {
    expect(isAppiumSession(session({ isMobile: true, isAndroid: true }))).toBe(
      true
    )
    expect(isAppiumSession(session({ isMobile: true, isIOS: true }))).toBe(true)
  })

  it('is true where WDIO excludes mobile web but the platform flag remains', () => {
    // Appium Chrome: WDIO's own `isMobile` is false (it excludes a chrome
    // automationName) while `isAndroid` stays true. Still an Appium session,
    // so still no BiDi — which is why the OR is right for THIS question and
    // was wrong for the document one.
    expect(isAppiumSession(session({ isMobile: false, isAndroid: true }))).toBe(
      true
    )
  })

  it('is false for a desktop session', () => {
    expect(isAppiumSession(session({}))).toBe(false)
  })
})
