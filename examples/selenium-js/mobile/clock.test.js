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

  /** The duration the setup screen shows, from whichever layout is live: a
   *  reset Clock renders it as one `timer_setup_time` field, a used one as
   *  separate hour/minute/second fields. */
  const durationText = async () => {
    const single = await driver.findElements(uiSelector('timer_setup_time'))
    if (single.length) {
      return (await single[0].getText()).trim()
    }
    const parts = []
    for (const id of ['hour_text', 'minute_text', 'second_text']) {
      const field = await driver.findElements(uiSelector(id))
      parts.push(field.length ? await field[0].getText() : '')
    }
    return parts.join(':')
  }

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

  it('keys a duration into the timer and corrects it', async function () {
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
      // A supplied app has none of Clock's screens, so capture its hierarchy
      // rather than looking for ids that cannot exist.
      assert.ok((await driver.getPageSource()).length > 0)
      return
    }

    // Re-activated rather than relying on the launch capability alone, so the
    // spec re-runs against a session left on another screen.
    await driver.executeScript('mobile: activateApp', { appId: APP_ID })
    await (await byId('tab_menu_timer')).click()

    // Backspace until it disables itself, so the run starts from a known zero
    // whatever the last one keyed in. WebdriverIO long-presses to clear in one
    // go; selenium-webdriver has no portable long press, and a keyed duration
    // is at most six digits.
    for (let i = 0; i < 8; i++) {
      const backspace = await byId('timer_setup_delete')
      if (!(await backspace.isEnabled())) {
        break
      }
      await backspace.click()
      await driver.sleep(200)
    }
    const cleared = await durationText()

    // The keypad fills from the right, so "1", "0", "0" reads as one minute.
    for (const digit of ['1', '0', '0']) {
      await (await byId(`timer_setup_digit_${digit}`)).click()
    }
    const keyed = await durationText()
    assert.notEqual(keyed, cleared, `the duration did not change: "${keyed}"`)
    // Backspace is disabled at zero and enabled by an entry, so this reads the
    // app's own state rather than the text the keypad just echoed.
    assert.ok(await (await byId('timer_setup_delete')).isEnabled())

    await (await byId('timer_setup_delete')).click()
    await driver.sleep(200)
    assert.notEqual(await durationText(), keyed)
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
