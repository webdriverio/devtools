// Nightwatch against Appium, ANDROID. The iOS example is a sibling spec in
// ../ios — a separate file rather than a branch, because the two platforms
// ship different apps and share no selectors.
//
// Nightwatch against Appium. The WebdriverIO, Selenium and Python mobile
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

const APP_ID = 'com.google.android.deskclock'
const isWeb = process.env.DEVTOOLS_MOBILE === 'web'

// An emulator often cannot resolve public DNS (corporate network, VPN), and
// `10.0.2.2` is its alias for the HOST's localhost — so a page served on this
// machine is reachable when the internet is not. See examples/MOBILE.md.
const WEB_URL =
  process.env.DEVTOOLS_MOBILE_URL ?? 'https://the-internet.herokuapp.com/login'
/** APPIUM_APP replaces Clock, so the Clock flow does not apply to it. */
const CUSTOM_APP = Boolean(process.env.APPIUM_APP)

/** A resource-id, in Nightwatch's element DEFINITION shape. The raw W3C
 *  `{using, value}` form is accepted syntactically and then issues no lookup
 *  at all, which reads as a missing element rather than a bad selector.
 *
 *  Appium's `id` strategy matches a full resource-id, which keeps this inside
 *  Nightwatch's own strategy set — it rejects `-android uiautomator` with an
 *  InvalidSelectorError rather than forwarding it. */
const byId = (id) => ({
  selector: `${APP_ID}:id/${id}`,
  locateStrategy: 'id'
})

/** The duration the setup screen shows, from whichever layout is live: a reset
 *  Clock renders it as one `timer_setup_time` field, a used one as separate
 *  hour/minute/second fields. */
async function durationText(browser) {
  // `isPresent`, not `elements()`: awaiting `browser.elements()` yields
  // undefined in this Nightwatch version, which reads as "nothing matched" for
  // every id. `findElements` would work but waits and then throws when nothing
  // matches, which Nightwatch reports as a run error even when caught.
  if (await browser.isPresent(byId('timer_setup_time'))) {
    return (await browser.getText(byId('timer_setup_time'))).trim()
  }
  const parts = []
  for (const id of ['hour_text', 'minute_text', 'second_text']) {
    parts.push(
      (await browser.isPresent(byId(id))) ? await browser.getText(byId(id)) : ''
    )
  }
  return parts.join(':')
}

describe('Clock (native)', function () {
  it('keys a duration into the timer and corrects it', async function (browser) {
    if (isWeb) {
      // A mobile BROWSER session: it has a document, so every page-side call a
      // native session skips must still happen. That contrast is the point.
      await browser.url(WEB_URL)
      await browser.assert.urlContains('http')
      return
    }
    if (CUSTOM_APP) {
      // A supplied app has none of Clock's screens, so capture its hierarchy
      // rather than looking for ids that cannot exist.
      const source = await browser.source()
      await browser.assert.ok(
        Boolean(source),
        'the view hierarchy was readable'
      )
      return
    }

    // Re-activated rather than relying on the launch capability alone, so the
    // spec re-runs against a session left on another screen.
    await browser.execute('mobile: activateApp', [{ appId: APP_ID }])
    await browser.click(byId('tab_menu_timer'))

    // Backspace until it disables itself, so the run starts from a known zero
    // whatever the last one keyed in. WebdriverIO long-presses to clear in one
    // go; Nightwatch has no portable long press, and a keyed duration is at
    // most six digits.
    for (let i = 0; i < 8; i++) {
      const enabled = await browser
        .isEnabled(byId('timer_setup_delete'))
        .catch(() => false)
      if (!enabled) {
        break
      }
      await browser.click(byId('timer_setup_delete'))
      await browser.pause(200)
    }
    const cleared = await durationText(browser)

    // The keypad fills from the right, so "1", "0", "0" reads as one minute.
    for (const digit of ['1', '0', '0']) {
      await browser.click(byId(`timer_setup_digit_${digit}`))
    }
    const keyed = await durationText(browser)
    await browser.assert.ok(
      keyed !== cleared,
      `the duration changed from "${cleared}" to "${keyed}"`
    )
    // Backspace is disabled at zero and enabled by an entry, so this reads the
    // app's own state rather than the text the keypad just echoed.
    await browser.assert.enabled(byId('timer_setup_delete'))

    await browser.click(byId('timer_setup_delete'))
    await browser.pause(200)
    const corrected = await durationText(browser)
    await browser.assert.ok(
      corrected !== keyed,
      `backspace changed the duration from "${keyed}" to "${corrected}"`
    )
  })

  it('captures a second action on the same session', async function (browser) {
    // A second test, so `traceGranularity: 'test'` has two slices to key.
    if (isWeb) {
      await browser.url(WEB_URL)
      await browser.assert.urlContains('http')
      return
    }

    if (CUSTOM_APP) {
      await browser.assert.ok(
        Boolean(await browser.source()),
        'the view hierarchy was readable'
      )
      return
    }
    await browser.execute('mobile: activateApp', [{ appId: APP_ID }])
    await browser.click(byId('tab_menu_stopwatch'))
    await browser.assert.visible(byId('tab_menu_stopwatch'))
  })
})
