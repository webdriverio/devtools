// WebdriverIO against Appium. The Selenium, Nightwatch and Python mobile
// examples drive the SAME flow, so a difference between two dashboards is a
// difference in the adapter rather than in the test.
//
// Drives the Clock app, which ships with every Android system image — no .apk,
// no upload, no credentials. Clock also gives a native session something
// deterministic to do: a timer can be started, paused and cleared, and each
// step changes the screen in a way the trace can be checked against.
//
// VERIFIED ON: Android emulator `sdk_gphone64_arm64`, Android 16 (API 36),
// Clock (com.google.android.deskclock) 9.1.
//
// These are resource-ids read off that build, and the Clock app updates
// INDEPENDENTLY of the Android version — so pinning a system image does not pin
// them. If a locator misses, re-read the tree rather than assuming capture
// broke: `adb shell uiautomator dump /sdcard/ui.xml && adb shell cat /sdcard/ui.xml`
// (a running countdown never reaches idle, so pause or clear the timer first).

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

/** Delete every timer already on the Timers tab, so the preset buttons are the
 *  ones on screen. Idempotent: no timers means nothing to click. */
async function clearExistingTimers(): Promise<void> {
  // Bounded by PROGRESS rather than by a count: any number of timers may have
  // piled up, and a fixed cap leaves the presets unreachable past it. A click
  // that fails to reduce the count is the stuck case, and says so instead of
  // falling through to a preset that is not on screen.
  let previous = Number.POSITIVE_INFINITY
  for (;;) {
    // `.getElements()`, not a bare await: `$$` returns a chainable whose
    // `.length` is a Promise, so `remaining.length` would be a Promise —
    // always truthy, and the "nothing left to clear" exit would never fire.
    const remaining = await $$(
      `android=new UiSelector().resourceId("${APP_ID}:id/delete_button")`
    ).getElements()
    if (!remaining.length) {
      return
    }
    if (remaining.length >= previous) {
      // Deleting works card by card, and a long pile-up scrolls the earliest
      // ones out of the viewport where a tap cannot reach them. One timer is
      // what an interrupted run leaves, so this is the unusual case — say how
      // Deleting works card by card, and a long pile-up scrolls the earliest
      // ones out of the viewport where a tap cannot reach them. One timer is
      // all an interrupted run leaves, so this is the unusual case — say how
      // to clear it rather than failing later on an absent preset.
      throw new Error(
        `could not clear ${remaining.length} leftover timer(s) from the Timers tab. Clear them by hand, or reset the app: adb shell pm clear com.google.android.deskclock`
      )
    }
    previous = remaining.length
    await remaining[0]!.click()
    await browser.pause(300)
  }
}

describe('Clock (native)', () => {
  it('starts a preset timer, pauses it, and clears it', async () => {
    if (isWeb) {
      // A mobile BROWSER session: it has a document, so every page-side call a
      // native session skips must still happen. That contrast is the point.
      await browser.url(WEB_URL)
      await expect(browser).toHaveUrl(expect.stringContaining('http'))
      return
    }

    if (CUSTOM_APP) {
      // A supplied app has none of Clock's screens, so driving the Clock flow against it would look for ids that cannot exist.
      // Capture its hierarchy instead — which is what a custom app is set here to exercise.
      const source = await browser.getPageSource()
      expect(source.length).toBeGreaterThan(0)
      return
    }

    // `mobile: activateApp` rather than relying on the launch capability alone:
    // it re-runs against a session left on another screen, and needs no
    // adb_shell, which Appium does not enable by default.
    await browser.execute('mobile: activateApp', { appId: APP_ID })

    await byId('tab_menu_timer').click()

    // Clear anything a previous run left behind. A timer SURVIVES the session,
    // and while one exists the Timers tab shows its card instead of the preset
    // buttons — so without this, one interrupted run breaks every later one.
    await clearExistingTimers()

    // This build starts the timer straight from the preset, so the running
    // countdown is the evidence the tap landed.
    await byId('timer_preset_2').click()
    await expect(byId('timer_text')).toHaveText(/^\d{2}:\d{2}$/)

    await byId('play_pause_button').click()
    // The control's accessibility label flips with the timer's state, so
    // asserting on it keeps this step off the countdown's own clock.
    await expect($('~Start 5 minutes timer')).toBeDisplayed()

    // Clearing the timer is what makes the spec re-runnable: it ends on the
    // same screen it started from.
    await byId('delete_button').click()
    await expect(byId('timer_text')).not.toBeDisplayed()
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
    await expect(byId('tab_menu_stopwatch')).toBeDisplayed()
    await byId('tab_menu_stopwatch').click()
  })
})
