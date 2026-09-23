/**
 * Mobile example for @wdio/selenium-devtools (Mocha runner), iOS. The Android
 * example is a sibling spec in ../android — a separate file rather than a
 * branch, because the two platforms ship different apps and share no selectors.
 *
 * Drives **Settings**, not Clock. Clock is simply not installed on the iOS
 * simulator: `xcrun simctl listapps` lists Settings, Calendar, Reminders, Maps,
 * Safari and a handful more, and no `com.apple.mobiletimer`. Settings is on
 * every simulator and every real device, so this needs no .app, no upload and
 * no credentials — the same property that makes Clock the Android choice.
 *
 * VERIFIED ON: iOS Simulator `iPhone 17 Pro`, iOS 26.5 (23F77), Xcode 26.
 *
 *   DEVTOOLS_MOBILE_PLATFORM=ios pnpm demo:selenium:mobile
 */

import { strict as assert } from 'node:assert'
import { Builder, until } from 'selenium-webdriver'
import { createRequire } from 'node:module'
import { DevTools } from '@wdio/selenium-devtools'

const { requireMobileToolchain, bootedSimulators } = createRequire(
  import.meta.url
)('../../../mobile-preflight.cjs')

DevTools.configure({
  mode: process.env.DEVTOOLS_MODE === 'live' ? 'live' : 'trace',
  traceGranularity: 'test'
})

const APP_ID = 'com.apple.Preferences'
const APPIUM = `http://${process.env.APPIUM_HOST ?? '127.0.0.1'}:${
  process.env.APPIUM_PORT ?? 4723
}`

/** The simulator to drive, as a udid. Naming one that does not exist does NOT
 *  fail: the XCUITest driver CREATES it and boots it, every run, beside the
 *  simulator already running. Defaults to whatever is already booted. */
function iosDevice() {
  if (process.env.IOS_UDID) {
    return { 'appium:udid': process.env.IOS_UDID }
  }
  const booted = bootedSimulators() ?? []
  const wanted = process.env.IOS_DEVICE_NAME
  const match = wanted
    ? booted.find((device) => device.name === wanted)
    : booted[0]
  if (match) {
    return { 'appium:udid': match.udid, 'appium:deviceName': match.name }
  }
  return { 'appium:deviceName': wanted ?? 'iPhone 17 Pro' }
}

function mobileCapabilities() {
  return {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    ...iosDevice(),
    ...(process.env.IOS_PLATFORM_VERSION
      ? { 'appium:platformVersion': process.env.IOS_PLATFORM_VERSION }
      : {}),
    'appium:bundleId': APP_ID,
    'appium:noReset': true,
    'appium:newCommandTimeout': 300,
    // selenium-webdriver's `Builder.build()` throws unless `browserName` is a
    // STRING, before it ever contacts the server — and a native session has no
    // browser. An empty string satisfies that check and is also the W3C signal
    // for "no browser", which is what the adapters read to skip page-side
    // capture.
    browserName: ''
  }
}

describe('Settings (native)', function () {
  this.timeout(180000)
  let driver

  const navBarTitle = async () => {
    // The raw `class name` strategy, not `By.className`: that compiles to a
    // CSS selector (`.XCUIElementTypeNavigationBar`) and Appium rejects it.
    const bars = await driver.findElements({
      using: 'class name',
      value: 'XCUIElementTypeNavigationBar'
    })
    return bars.length ? ((await bars[0].getDomAttribute('name')) ?? '') : ''
  }

  before(async function () {
    await requireMobileToolchain()
    driver = await new Builder()
      .usingServer(APPIUM)
      .withCapabilities(mobileCapabilities())
      .build()
  })

  after(async function () {
    if (driver) {
      await driver.quit()
    }
  })

  it('navigates into a settings page and back', async function () {
    // Terminated before activating, not merely activated: Settings remembers
    // the page the last run drilled into, so activating alone would start
    // somewhere unpredictable. This is what makes the spec re-runnable.
    await driver.executeScript('mobile: terminateApp', { bundleId: APP_ID })
    await driver.executeScript('mobile: activateApp', { bundleId: APP_ID })
    assert.match(await navBarTitle(), /Settings/)

    await driver
      .wait(
        until.elementLocated({ using: 'accessibility id', value: 'General' }),
        15000
      )
      .click()
    await driver.wait(async () => /General/.test(await navBarTitle()), 15000)

    // Back through the navigation stack rather than a tap on the back button:
    // that button's accessibility id is the PARENT page's title, so tapping by
    // name hits whichever row happens to share it — measured, it opened About.
    await driver.navigate().back()
    await driver.wait(async () => /Settings/.test(await navBarTitle()), 15000)
  })

  it('captures a second action on the same session', async function () {
    // A second test, so `traceGranularity: 'test'` has two slices to key.
    await driver.executeScript('mobile: activateApp', { bundleId: APP_ID })
    assert.match(await navBarTitle(), /Settings/)
  })
})
