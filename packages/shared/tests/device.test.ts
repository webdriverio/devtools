import { describe, expect, it } from 'vitest'

import {
  deviceFromCapabilities,
  deviceLabel,
  isNativeAppSession,
  isNativePlatform
} from '../src/device.js'

/** Capability bags as real sessions report them, per the measurements in #345. */
const LOCAL_ANDROID = {
  platformName: 'Android',
  'appium:deviceName': 'Pixel_7_API_34',
  'appium:platformVersion': '14'
}
/** A device cloud reports the hardware serial as BOTH deviceName and udid; the
 *  friendly name is only in deviceModel. */
const CLOUD_ANDROID = {
  platformName: 'android',
  deviceName: '28111FDH200CUX',
  udid: '28111FDH200CUX',
  deviceModel: 'Pixel 7',
  platformVersion: '14'
}
const IOS = {
  platformName: 'iOS',
  deviceName: 'iPhone 17',
  udid: '00008140-001A2C3D4E5F001E',
  'appium:platformVersion': '18.1'
}
const DESKTOP = {
  browserName: 'chrome',
  browserVersion: '152',
  platform: 'mac'
}

describe('isNativePlatform', () => {
  it('accepts the two native platforms and nothing else', () => {
    expect(isNativePlatform('android')).toBe(true)
    expect(isNativePlatform('ios')).toBe(true)
    expect(isNativePlatform('windows')).toBe(false)
    expect(isNativePlatform(undefined)).toBe(false)
  })
})

describe('deviceFromCapabilities', () => {
  it('is undefined for a desktop session', () => {
    expect(deviceFromCapabilities(DESKTOP)).toBeUndefined()
  })

  it('is undefined for input that is no capability bag', () => {
    expect(deviceFromCapabilities(undefined)).toBeUndefined()
    expect(deviceFromCapabilities('android')).toBeUndefined()
    expect(deviceFromCapabilities({})).toBeUndefined()
  })

  it('reads a local run from appium:deviceName', () => {
    expect(deviceFromCapabilities(LOCAL_ANDROID)).toEqual({
      platform: 'android',
      name: 'Pixel_7_API_34',
      version: '14'
    })
  })

  it('prefers deviceModel over a deviceName that repeats the serial', () => {
    expect(deviceFromCapabilities(CLOUD_ANDROID)).toEqual({
      platform: 'android',
      name: 'Pixel 7',
      version: '14'
    })
  })

  it("keeps iOS's friendly deviceName, which is not its udid", () => {
    expect(deviceFromCapabilities(IOS)).toEqual({
      platform: 'ios',
      name: 'iPhone 17',
      version: '18.1'
    })
  })

  it('normalizes the platform case the session reported', () => {
    expect(deviceFromCapabilities({ platformName: 'IOS' })).toEqual({
      platform: 'ios'
    })
  })

  it('reports the platform alone when every name is the serial', () => {
    expect(
      deviceFromCapabilities({
        platformName: 'android',
        deviceName: 'R5CT10',
        'appium:deviceName': 'R5CT10',
        udid: 'R5CT10'
      })
    ).toEqual({ platform: 'android' })
  })

  it('ignores blank and non-string capability values', () => {
    expect(
      deviceFromCapabilities({
        platformName: 'ios',
        'appium:deviceName': '   ',
        deviceModel: 17,
        deviceName: 'iPad Pro'
      })
    ).toEqual({ platform: 'ios', name: 'iPad Pro' })
  })
})

/** A cloud that states the platform only in its own bag used to read as a
 *  desktop session, so its trace carried no device and the player framed a
 *  phone as a browser window. */
describe('deviceFromCapabilities with vendor options', () => {
  it('reads the whole device out of a vendor bag', () => {
    // Every part, not just the platform: with a shallow name read this device
    // was labelled bare "android" in the player.
    expect(
      deviceFromCapabilities({
        'bstack:options': {
          platformName: 'android',
          deviceModel: 'Pixel 7',
          platformVersion: '14'
        }
      })
    ).toEqual({ platform: 'android', name: 'Pixel 7', version: '14' })
  })

  it('still rejects a name that only repeats the serial', () => {
    // The cloud reports the serial as both deviceName and udid; reading one
    // level deeper must not lose that rejection.
    expect(
      deviceFromCapabilities({
        'bstack:options': {
          platformName: 'android',
          deviceName: '28111FDH200CUX',
          udid: '28111FDH200CUX'
        }
      })
    ).toEqual({ platform: 'android' })
  })
})

describe('deviceLabel', () => {
  it('reads as name, platform and version', () => {
    expect(
      deviceLabel({ platform: 'ios', name: 'iPhone 17', version: '18.1' })
    ).toBe('iPhone 17 (ios 18.1)')
  })

  it('degrades to what the device actually reported', () => {
    expect(deviceLabel({ platform: 'android', name: 'Pixel 7' })).toBe(
      'Pixel 7 (android)'
    )
    expect(deviceLabel({ platform: 'android', version: '14' })).toBe(
      'android 14'
    )
    expect(deviceLabel({ platform: 'android' })).toBe('android')
  })
})

/**
 * Whether the session had a document. Not answerable from the device alone: an
 * Appium session driving Chrome runs on a phone and has a real page, and gating
 * a DOM drain on "is it a phone" took all DOM capture away from one.
 */
describe('isNativeAppSession', () => {
  const MOBILE_WEB_ANDROID = {
    platformName: 'Android',
    browserName: 'Chrome',
    'appium:automationName': 'Chrome'
  }
  const MOBILE_WEB_IOS = {
    platformName: 'iOS',
    browserName: 'Safari',
    'appium:automationName': 'XCUITest'
  }
  /** A cloud states both facts inside its own bag and neither at the top. */
  const CLOUD_NESTED_WEB = {
    'bstack:options': {
      platformName: 'Android',
      deviceName: 'Google Pixel 7',
      browserName: 'Chrome'
    }
  }
  const CLOUD_NESTED_APP = {
    'bstack:options': {
      platformName: 'Android',
      deviceName: 'Google Pixel 7',
      appiumVersion: '2.0.0'
    }
  }

  it('is true for a session that named no browser', () => {
    expect(isNativeAppSession(LOCAL_ANDROID)).toBe(true)
    expect(isNativeAppSession(CLOUD_ANDROID)).toBe(true)
    expect(isNativeAppSession(IOS)).toBe(true)
  })

  it('is false for a session that named one', () => {
    expect(isNativeAppSession(MOBILE_WEB_ANDROID)).toBe(false)
    expect(isNativeAppSession(MOBILE_WEB_IOS)).toBe(false)
  })

  it('is false for a desktop session, which has no device at all', () => {
    expect(isNativeAppSession(DESKTOP)).toBe(false)
  })

  it('reads both facts out of a vendor bag', () => {
    // Neither key is at the top level here, so a shallow read calls the web
    // session desktop and the app session desktop too.
    expect(isNativeAppSession(CLOUD_NESTED_WEB)).toBe(false)
    expect(isNativeAppSession(CLOUD_NESTED_APP)).toBe(true)
  })

  it('is true for an Appium session with no device platform', () => {
    // Mac2, WinAppDriver and tvOS have no document either, and answering "web"
    // for them is the expensive direction: the service's post-action settle
    // then polls a failing probe for its full 8 s timeout, per action.
    expect(
      isNativeAppSession({
        platformName: 'mac',
        'appium:automationName': 'Mac2',
        'appium:bundleId': 'com.apple.TextEdit'
      })
    ).toBe(true)
    expect(
      isNativeAppSession({
        platformName: 'tvOS',
        'appium:automationName': 'XCUITest'
      })
    ).toBe(true)
  })

  it('is false for a desktop browser, which names no automation', () => {
    expect(
      isNativeAppSession({ browserName: 'firefox', 'moz:firefoxOptions': {} })
    ).toBe(false)
  })

  it('reads a blank browserName as no browser at all', () => {
    // A driver that echoes the key rather than omitting it must not read as
    // web, or a native app loses the guard.
    expect(
      isNativeAppSession({ platformName: 'Android', browserName: '   ' })
    ).toBe(true)
  })

  it('says nothing about a bag it cannot read', () => {
    // False, not true, is the safe answer with no information: a guard that
    // fails open costs a failed round trip and a log line, one that fails
    // closed costs the run's whole DOM capture.
    expect(isNativeAppSession(undefined)).toBe(false)
    expect(isNativeAppSession('android')).toBe(false)
    expect(isNativeAppSession({})).toBe(false)
  })
})
