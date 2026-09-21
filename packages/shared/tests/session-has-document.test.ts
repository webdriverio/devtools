/**
 * #376: `isNativeAppSession` answers from the startup bag and cannot change, so
 * a hybrid app that switched into a webview kept being treated as native and
 * its webview portion carried no DOM at all.
 */

import { describe, it, expect } from 'vitest'
import {
  NATIVE_APP_CONTEXT,
  isWebviewContext,
  sessionHasDocument
} from '../src/device.js'

const NATIVE = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2'
}
const MOBILE_WEB = { platformName: 'Android', browserName: 'chrome' }
const DESKTOP = { browserName: 'chrome', platformName: 'linux' }

describe('isWebviewContext', () => {
  it('treats anything that is not the native context as a webview', () => {
    expect(isWebviewContext('WEBVIEW_com.example')).toBe(true)
    expect(isWebviewContext('WEBVIEW_chrome')).toBe(true)
    // The WEBVIEW_ prefix is a convention, not a guarantee — matching on it
    // would read a differently-named webview as native and skip its capture.
    expect(isWebviewContext('CHROMIUM')).toBe(true)
  })

  it('treats the native context, and no context at all, as not a webview', () => {
    expect(isWebviewContext(NATIVE_APP_CONTEXT)).toBe(false)
    expect(isWebviewContext(undefined)).toBe(false)
    expect(isWebviewContext('')).toBe(false)
  })
})

describe('sessionHasDocument', () => {
  // A hybrid session starts in the native context, so no observed context is
  // the native one rather than an unknown.
  it('answers false for a native session that has not switched', () => {
    expect(sessionHasDocument(NATIVE)).toBe(false)
    expect(sessionHasDocument(NATIVE, NATIVE_APP_CONTEXT)).toBe(false)
  })

  it('answers true once that session enters a webview', () => {
    expect(sessionHasDocument(NATIVE, 'WEBVIEW_com.example')).toBe(true)
  })

  it('answers false again when it switches back', () => {
    expect(sessionHasDocument(NATIVE, NATIVE_APP_CONTEXT)).toBe(false)
  })

  // A browser session has a document regardless; it has no contexts to switch.
  it('is unaffected by context for a browser session', () => {
    for (const context of [undefined, NATIVE_APP_CONTEXT, 'WEBVIEW_x']) {
      expect(sessionHasDocument(MOBILE_WEB, context)).toBe(true)
      expect(sessionHasDocument(DESKTOP, context)).toBe(true)
    }
  })
})
