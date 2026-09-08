import { describe, expect, it } from 'vitest'

import {
  deviceFromCapabilities,
  deviceLabel,
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
