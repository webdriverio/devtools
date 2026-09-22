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

describe('Clock (native)', function () {
  it('starts a preset timer, pauses it, and clears it', async function (browser) {
    if (isWeb) {
      // A mobile BROWSER session: it has a document, so every page-side call a
      // native session skips must still happen. That contrast is the point.
      await browser.url('https://the-internet.herokuapp.com/login')
      await browser.assert.urlContains('the-internet')
      return
    }

    // Re-activated rather than relying on the launch capability alone, so the
    // spec re-runs against a session left on another screen.
    if (CUSTOM_APP) {
      // A supplied app has none of Clock's screens, so driving the Clock flow
      // against it would look for ids that cannot exist. Capture its hierarchy
      // instead — which is what a custom app is set here to exercise.
      const source = await browser.source()
      await browser.assert.ok(
        Boolean(source),
        'the view hierarchy was readable'
      )
      return
    }

    await browser.execute('mobile: activateApp', [{ appId: APP_ID }])

    await browser.click(byId('tab_menu_timer'))

    // Clear anything a previous run left behind. A timer SURVIVES the session,
    // and while one exists the Timers tab shows its card instead of the preset
    // buttons — so without this, one interrupted run breaks every later one.
    for (let i = 0; i < 5; i++) {
      // `elements()` is the protocol-level lookup: it hands back a result with
      // an empty list. The higher-level `findElements()` instead WAITS for a
      // match and then throws NoSuchElementError, which Nightwatch reports as a
      // run error even when caught — so "nothing to clear" would fail the test.
      const found = await browser.elements('id', `${APP_ID}:id/delete_button`)
      const count = Array.isArray(found)
        ? found.length
        : (found?.value?.length ?? 0)
      if (!count) {
        break
      }
      await browser.click(byId('delete_button'))
      await browser.pause(300)
    }

    // This build starts the timer straight from the preset, so the running
    // countdown is the evidence the tap landed.
    await browser.click(byId('timer_preset_2'))
    await browser.assert.visible(byId('timer_text'))

    await browser.click(byId('play_pause_button'))
    // The control's accessibility label flips with the timer's state, so
    // asserting on it keeps this step off the countdown's own clock.
    await browser.assert.attributeMatches(
      byId('play_pause_button'),
      'content-desc',
      /^Start/
    )

    // Clearing the timer is what makes the spec re-runnable: it ends on the
    // same screen it started from.
    await browser.click(byId('delete_button'))
    await browser.pause(500)
    await browser.assert.not.elementPresent(byId('timer_text'))
  })

  it('captures a second action on the same session', async function (browser) {
    // A second test, so `traceGranularity: 'test'` has two slices to key.
    if (isWeb) {
      await browser.url('https://the-internet.herokuapp.com/')
      await browser.assert.urlContains('herokuapp.com')
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
