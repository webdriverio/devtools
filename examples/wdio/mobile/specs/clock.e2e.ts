// WebdriverIO against Appium. The Selenium, Nightwatch and Python mobile
// examples drive the SAME flow, so a difference between two dashboards is a
// difference in the adapter rather than in the test.
//
// Drives the Clock app, which ships with every Android system image — no .apk,
// no upload, no credentials — and uses only the timer SETUP screen: tap the
// keypad, read the duration back, correct it with backspace.
//
// It deliberately never STARTS a timer. A running timer survives the session
// and replaces the setup screen with its card, so a spec that starts one is
// re-runnable only if it also finishes; an interrupted run would break every
// later one. Not starting one removes that whole class of failure, and the
// keypad still exercises what an example is for — real input, real state
// change, captured.
//
// VERIFIED ON: Android emulator `sdk_gphone64_arm64`, Android 16 (API 36),
// Clock (com.google.android.deskclock) 9.1, from a freshly reset app.
//
// Two Clock layouts exist on that one app version: a reset device renders the
// duration as a single `timer_setup_time` field, a used one as separate
// hour/minute/second fields, and only the latter offers the `timer_preset_*`
// suggestion chips — which is why those chips are not used here. The keypad is
// common to both. If a locator misses, re-read the tree rather than assuming
// capture broke:
// `adb shell uiautomator dump /sdcard/ui.xml && adb shell cat /sdcard/ui.xml`.

import { expect } from '@wdio/globals'

const APP_ID = 'com.google.android.deskclock'

const isWeb = process.env.DEVTOOLS_MOBILE === 'web'
/** APPIUM_APP replaces Clock, so the Clock flow does not apply to it. */
const CUSTOM_APP = Boolean(process.env.APPIUM_APP)

// An emulator often cannot resolve public DNS (corporate network, VPN), and
// `10.0.2.2` is its alias for the HOST's localhost — so a page served on this
// machine is reachable when the internet is not. See examples/MOBILE.md.
const WEB_URL =
  process.env.DEVTOOLS_MOBILE_URL ?? 'https://the-internet.herokuapp.com/login'

const byId = (id: string) =>
  $(`android=new UiSelector().resourceId("${APP_ID}:id/${id}")`)

const allById = (id: string) =>
  $$(`android=new UiSelector().resourceId("${APP_ID}:id/${id}")`).getElements()

/** The duration the setup screen shows, from whichever layout is live. */
async function durationText(): Promise<string> {
  const single = await allById('timer_setup_time')
  if (single.length) {
    return (await single[0]!.getText()).trim()
  }
  const parts: string[] = []
  for (const id of ['hour_text', 'minute_text', 'second_text']) {
    const field = await allById(id)
    parts.push(field.length ? await field[0]!.getText() : '')
  }
  return parts.join(':')
}

describe('Clock (native)', () => {
  it('keys a duration into the timer and corrects it', async () => {
    if (isWeb) {
      // A mobile BROWSER session: it has a document, so every page-side call a
      // native session skips must still happen. That contrast is the point.
      await browser.url(WEB_URL)
      await expect(browser).toHaveUrl(expect.stringContaining('http'))
      return
    }
    if (CUSTOM_APP) {
      // A supplied app has none of Clock's screens, so capture its hierarchy
      // rather than looking for ids that cannot exist.
      expect((await browser.getPageSource()).length).toBeGreaterThan(0)
      return
    }

    // Re-activated rather than relying on the launch capability alone, so the
    // spec re-runs against a session left on another screen.
    await browser.execute('mobile: activateApp', { appId: APP_ID })
    await byId('tab_menu_timer').click()

    // Long press clears the whole entry where a tap removes one digit, so the
    // run starts from a known zero whatever the last one keyed in.
    await byId('timer_setup_delete').longPress()
    const cleared = await durationText()

    // The keypad fills from the right, so "1", "0", "0" reads as one minute.
    for (const digit of ['1', '0', '0']) {
      await byId(`timer_setup_digit_${digit}`).click()
    }
    const keyed = await durationText()
    expect(keyed).not.toBe(cleared)
    // Backspace is disabled at zero and enabled by an entry, so this reads the
    // app's own state rather than the text the keypad just echoed.
    await expect(byId('timer_setup_delete')).toBeEnabled()

    await byId('timer_setup_delete').click()
    expect(await durationText()).not.toBe(keyed)
  })

  it('captures a second action on the same session', async () => {
    // A second test, so `traceGranularity: 'test'` has two slices to key.
    if (isWeb) {
      await browser.url(WEB_URL)
      return
    }
    if (CUSTOM_APP) {
      expect((await browser.getPageSource()).length).toBeGreaterThan(0)
      return
    }

    await browser.execute('mobile: activateApp', { appId: APP_ID })
    await byId('tab_menu_stopwatch').click()
    await expect(byId('tab_menu_stopwatch')).toBeDisplayed()
  })
})
