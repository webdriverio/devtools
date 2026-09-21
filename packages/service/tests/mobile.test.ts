import { describe, expect, it } from 'vitest'

import { NATIVE_APP_CONTEXT } from '@wdio/devtools-shared'

import { inPageProbesDeadlock, isAppiumSession } from '../src/mobile.js'

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

/**
 * The per-action snapshot is issued from inside the command hook, and Appium
 * serialises it behind the command it observes. Only the IN-PAGE probes hang
 * there, so the gate has to ask whether a document is in play rather than
 * whether the driver is Appium — the blanket answer left a native trace with
 * one snapshot for the whole run, taken at its end.
 */
const appium = (caps: Record<string, unknown>) =>
  ({ isMobile: true, isAndroid: true, capabilities: caps }) as never

const NATIVE_CAPS = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2'
}
const MOBILE_WEB_CAPS = { platformName: 'Android', browserName: 'chrome' }

describe('inPageProbesDeadlock', () => {
  it('clears a native session, which runs no in-page script', () => {
    expect(inPageProbesDeadlock(appium(NATIVE_CAPS))).toBe(false)
    expect(inPageProbesDeadlock(appium(NATIVE_CAPS), NATIVE_APP_CONTEXT)).toBe(
      false
    )
  })

  it('holds for the webview half of that same session', () => {
    expect(inPageProbesDeadlock(appium(NATIVE_CAPS), 'WEBVIEW_com.x')).toBe(
      true
    )
  })

  it('holds for a mobile browser, which is all document', () => {
    expect(inPageProbesDeadlock(appium(MOBILE_WEB_CAPS))).toBe(true)
  })

  it('clears a desktop session, which is not serialised at all', () => {
    expect(
      inPageProbesDeadlock({ capabilities: { browserName: 'chrome' } } as never)
    ).toBe(false)
  })
})
