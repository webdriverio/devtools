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

const { requireMobileToolchain, resolveIosDevice } = createRequire(
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

const isWeb = process.env.DEVTOOLS_MOBILE === 'web'
/** APPIUM_APP replaces Settings, so the Settings flow does not apply to it. */
const CUSTOM_APP = Boolean(process.env.APPIUM_APP)

// A simulator shares the host's network stack, so `localhost` here is this
// machine — no `10.0.2.2` alias like the Android emulator needs.
const WEB_URL =
  process.env.DEVTOOLS_MOBILE_URL ?? 'https://the-internet.herokuapp.com/login'

function mobileCapabilities() {
  const base = {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    // Which simulator, resolved to a udid — see `resolveIosDevice`.
    ...resolveIosDevice(),
    ...(process.env.IOS_PLATFORM_VERSION
      ? { 'appium:platformVersion': process.env.IOS_PLATFORM_VERSION }
      : {}),
    'appium:noReset': true,
    'appium:newCommandTimeout': 300,
    // selenium-webdriver's `Builder.build()` throws unless `browserName` is a
    // STRING, before it ever contacts the server — and a native session has no
    // browser. An empty string satisfies that check and is also the W3C signal
    // for "no browser", which is what the adapters read to skip page-side
    // capture.
    browserName: ''
  }
  if (isWeb) {
    // Names a browser, so this session HAS a document and keeps its page-side
    // capture — the distinction the native guards turn on. Safari is driven by
    // the XCUITest driver itself, where Chrome on Android needs a chromedriver.
    return { ...base, browserName: 'safari' }
  }
  if (CUSTOM_APP) {
    return { ...base, 'appium:app': process.env.APPIUM_APP }
  }
  return { ...base, 'appium:bundleId': APP_ID }
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
    if (isWeb) {
      // A mobile BROWSER session: it has a document, so every page-side call a
      // native session skips must still happen. That contrast is the point.
      await driver.get(WEB_URL)
      assert.match(await driver.getCurrentUrl(), /^http/)
      return
    }
    if (CUSTOM_APP) {
      // A supplied app has none of Settings' screens, so capture its hierarchy
      // rather than looking for ids that cannot exist.
      assert.ok((await driver.getPageSource()).length > 0)
      return
    }
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
    if (isWeb) {
      await driver.get(WEB_URL)
      return
    }
    if (CUSTOM_APP) {
      assert.ok((await driver.getPageSource()).length > 0)
      return
    }
    await driver.executeScript('mobile: activateApp', { bundleId: APP_ID })
    assert.match(await navBarTitle(), /Settings/)
  })
})
