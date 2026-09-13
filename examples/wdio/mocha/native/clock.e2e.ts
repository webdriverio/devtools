// A native Android spec: no document, no URL, no DOM — the capture path a
// browser session never exercises. Drives Clock, which ships with every Android
// system image, so the example needs no APK and no app upload.
//
// Every selector below was read off an emulator (API 37, Clock from
// com.google.android.deskclock); resource-ids are used over text because the
// countdown text changes every second.
import { expect } from '@wdio/globals'

const APP_ID = 'com.google.android.deskclock'

const byId = (id: string) =>
  $(
    `android=new UiSelector().resourceId("com.google.android.deskclock:id/${id}")`
  )

describe('Clock (native)', () => {
  it('starts a preset timer, pauses it, and clears it', async () => {
    console.log('[TEST] launching the Clock app')
    // `mobile: activateApp` rather than an `appium:app`/`appActivity`
    // capability: the activity name is build-specific and this needs no
    // adb_shell, which Appium does not enable by default.
    await browser.execute('mobile: activateApp', { appId: APP_ID })

    console.log('[TEST] opening the Timers tab')
    await byId('tab_menu_timer').click()

    console.log('[TEST] starting the 5 minute preset')
    // This build starts the timer straight from the preset — verified on the
    // device — so the running countdown is the evidence the tap landed.
    await byId('timer_preset_2').click()
    await expect(byId('timer_text')).toHaveText(/^\d{2}:\d{2}$/)

    console.log('[TEST] pausing the timer')
    await byId('play_pause_button').click()
    // The button's accessibility label flips with the timer's state; asserting
    // on it keeps this step off the countdown's own clock.
    await expect($('~Start 5 minutes timer')).toBeDisplayed()

    console.log('[TEST] clearing the timer')
    await byId('delete_button').click()
    await expect(byId('timer_text')).not.toBeDisplayed()
  })
})
