/**
 * Mobile example for @wdio/selenium-devtools (Mocha runner).
 *
 * Drives the Clock app, which ships with every Android system image, so it
 * needs no .apk. The WebdriverIO, Nightwatch and Python mobile examples drive
 * the SAME flow, so a difference between two dashboards is a difference in the
 * adapter rather than in the test. See examples/MOBILE.md for prerequisites and
 * the DEVTOOLS_MOBILE / APPIUM_APP switches.
 *
 * VERIFIED ON: Android emulator `sdk_gphone64_arm64`, Android 16 (API 36),
 * Clock (com.google.android.deskclock) 9.1. The Clock app updates independently
 * of the Android version, so pinning a system image does not pin these ids —
 * re-read the tree with `adb shell uiautomator dump` if one misses.
 *
 *   pnpm demo:selenium:mobile
 *   DEVTOOLS_MODE=live pnpm demo:selenium:mobile
 *
 * The dashboard starts itself — nothing needs a backend run by hand.
 */

import { strict as assert } from 'node:assert'
import { Builder, until } from 'selenium-webdriver'
import { createRequire } from 'node:module'
import { DevTools } from '@wdio/selenium-devtools'

const { requireMobileToolchain } = createRequire(import.meta.url)(
  '../../mobile-preflight.cjs'
)

DevTools.configure({
  // Trace by default, matching the desktop demos.
  mode: process.env.DEVTOOLS_MODE === 'live' ? 'live' : 'trace',
  traceGranularity: 'test'
})

const APP_ID = 'com.google.android.deskclock'
const isWeb = process.env.DEVTOOLS_MOBILE === 'web'
/** APPIUM_APP replaces Clock, so the Clock flow does not apply to it. */
const CUSTOM_APP = Boolean(process.env.APPIUM_APP)
const IOS = process.env.DEVTOOLS_MOBILE_PLATFORM === 'ios'
const APPIUM = `http://${process.env.APPIUM_HOST ?? '127.0.0.1'}:${
  process.env.APPIUM_PORT ?? 4723
}`

/** The same bag the other three mobile examples build; see
 *  examples/wdio/mobile/capabilities.ts for the annotated original. */
function mobileCapabilities() {
  const base = {
    platformName: IOS ? 'iOS' : 'Android',
    'appium:automationName': IOS ? 'XCUITest' : 'UiAutomator2',
    // iOS needs the simulator named, and it is per-machine:
    // `xcrun simctl list devices` shows yours.
    ...(IOS
      ? {
          'appium:deviceName': process.env.IOS_DEVICE_NAME ?? 'iPhone 15',
          ...(process.env.IOS_PLATFORM_VERSION
            ? { 'appium:platformVersion': process.env.IOS_PLATFORM_VERSION }
            : {})
        }
      : {}),
    'appium:noReset': true,
    'appium:newCommandTimeout': 300,
    // selenium-webdriver's `Builder.build()` throws unless `browserName` is a
    // STRING, before it ever contacts the server — and a native session has no
    // browser. An empty string satisfies that check and is also the W3C signal
    // for "no browser", which is what the adapters read to skip page-side
    // capture. `withCapabilities` alone does not set it.
    browserName: ''
  }
  if (isWeb) {
    // Names a browser, so this session HAS a document and keeps its page-side
    // capture — the distinction the native guards turn on.
    return {
      ...base,
      // Chrome on the device needs a matching chromedriver. Appium can
      // fetch one, but that is a SERVER feature, not a capability:
      // `--allow-insecure=uiautomator2:chromedriver_autodownload`.
      browserName: IOS ? 'safari' : 'chrome'
    }
  }
  if (process.env.APPIUM_APP) {
    return { ...base, 'appium:app': process.env.APPIUM_APP }
  }
  if (IOS) {
    return { ...base, 'appium:bundleId': 'com.apple.mobiletimer' }
  }
  return {
    ...base,
    'appium:appPackage': APP_ID,
    'appium:appActivity': 'com.android.deskclock.DeskClock'
  }
}

describe('Clock (native)', function () {
  this.timeout(180000)
  let driver

  /** A resource-id on the Clock app. UiAutomator2's own selector strategy,
   *  because selenium-webdriver's By.* helpers only speak web locators. */
  const uiSelector = (id) => ({
    using: '-android uiautomator',
    value: `new UiSelector().resourceId("${APP_ID}:id/${id}")`
  })
  /** Waited for, not just looked up: selenium-webdriver does no implicit wait,
   *  so a tap that starts a screen transition is followed by a findElement the
   *  destination has not rendered yet. WebdriverIO auto-waits and hides this. */
  const byId = async (id) =>
    driver.wait(until.elementLocated(uiSelector(id)), 15000)

  before(async function () {
    // A missing emulator or Appium reads as a prerequisite here rather than as
    // an ECONNREFUSED stack trace out of the driver.
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

  it('starts a preset timer, pauses it, and clears it', async function () {
    if (isWeb) {
      // A mobile BROWSER session: it has a document, so every page-side call a
      // native session skips must still happen. That contrast is the point.
      await driver.get(
        process.env.DEVTOOLS_MOBILE_URL ??
          'https://the-internet.herokuapp.com/login'
      )
      assert.ok((await driver.getCurrentUrl()).length > 0)
      return
    }

    if (CUSTOM_APP) {
      // A supplied app has none of Clock's screens, so driving the Clock flow
      // against it would look for ids that cannot exist. Capture its hierarchy
      // instead — which is what a custom app is set here to exercise.
      assert.ok((await driver.getPageSource()).length > 0)
      return
    }

    // Re-activated rather than relying on the launch capability alone, so the
    // spec re-runs against a session left on another screen.
    await driver.executeScript('mobile: activateApp', { appId: APP_ID })

    await (await byId('tab_menu_timer')).click()

    // Clear anything a previous run left behind. A timer SURVIVES the session,
    // and while one exists the Timers tab shows its card instead of the preset
    // buttons — so without this, one interrupted run breaks every later one.
    for (let i = 0; i < 5; i++) {
      const remaining = await driver.findElements(uiSelector('delete_button'))
      if (!remaining.length) {
        break
      }
      await remaining[0].click()
      await driver.sleep(300)
    }

    // This build starts the timer straight from the preset, so the running
    // countdown is the evidence the tap landed.
    await (await byId('timer_preset_2')).click()
    const running = await (await byId('timer_text')).getText()
    assert.match(running, /^\d{2}:\d{2}$/, `timer_text was "${running}"`)

    await (await byId('play_pause_button')).click()
    // The control's accessibility label flips with the timer's state, so
    // asserting on it keeps this step off the countdown's own clock.
    // `getDomAttribute`, NOT `getAttribute`: selenium-webdriver implements the
    // latter by executing a JavaScript atom, and a native session has no JS to
    // run it in — it fails with "Method is not implemented". `getDomAttribute`
    // is the plain W3C endpoint, which Appium serves.
    const label = await (
      await byId('play_pause_button')
    ).getDomAttribute('content-desc')
    assert.match(
      label,
      /^Start/,
      `expected the paused control to offer Start, got "${label}"`
    )

    // Clearing the timer is what makes the spec re-runnable: it ends on the
    // same screen it started from.
    await (await byId('delete_button')).click()
    await driver.sleep(500)
    assert.equal(
      (await driver.findElements(uiSelector('timer_text'))).length,
      0,
      'the cleared timer is still on screen'
    )
  })

  it('captures a second action on the same session', async function () {
    // A second test, so `traceGranularity: 'test'` has two slices to key.
    if (isWeb) {
      await driver.get('https://the-internet.herokuapp.com/')
      assert.match(await driver.getCurrentUrl(), /herokuapp\.com/)
      return
    }

    if (CUSTOM_APP) {
      assert.ok((await driver.getPageSource()).length > 0)
      return
    }
    await driver.executeScript('mobile: activateApp', { appId: APP_ID })
    await (await byId('tab_menu_stopwatch')).click()
  })
})
