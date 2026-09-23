// WebdriverIO against Appium, iOS. The Android example is a sibling spec in
// ../android — a separate file rather than a branch, because the two platforms
// ship different apps and share no selectors.
//
// Drives **Settings**, not Clock. Clock is simply not installed on the iOS
// simulator: `xcrun simctl listapps` lists Settings, Calendar, Reminders,
// Maps, Safari and a handful more, and no `com.apple.mobiletimer`. Settings is
// on every simulator and every real device, so this needs no .app, no upload
// and no credentials — the same property that makes Clock the Android choice.
//
// The shape matches the Android spec even though the interactions cannot:
// put the app in a known state, change it, and read the change back.
//
// VERIFIED ON: iOS Simulator `iPhone 17 Pro`, iOS 26.5 (23F77), Xcode 26.
//
// iOS locators are accessibility ids and labels rather than resource-ids, so
// nothing here transfers from the Android spec. To re-read the tree, point
// Appium Inspector at the booted simulator, or dump it with a one-off session
// — an element's `name` is what `~` matches.

import { expect } from '@wdio/globals'

/** Settings. Present on every simulator and device, unlike Clock. */
const APP_ID = 'com.apple.Preferences'

const isWeb = process.env.DEVTOOLS_MOBILE === 'web'
/** APPIUM_APP replaces Settings, so the Settings flow does not apply to it. */
const CUSTOM_APP = Boolean(process.env.APPIUM_APP)

// A simulator shares the host's network stack, so `localhost` here is this
// machine — no `10.0.2.2` alias like the Android emulator needs.
const WEB_URL =
  process.env.DEVTOOLS_MOBILE_URL ?? 'https://the-internet.herokuapp.com/login'

/** The navigation bar's title, which is how Settings says where it is. */
async function navBarTitle(): Promise<string> {
  const bars = await $$('XCUIElementTypeNavigationBar').getElements()
  return bars.length ? ((await bars[0]!.getAttribute('name')) ?? '') : ''
}

describe('Settings (native)', () => {
  it('navigates into a settings page and back', async () => {
    if (isWeb) {
      // A mobile BROWSER session: it has a document, so every page-side call a
      // native session skips must still happen. That contrast is the point,
      // and it costs nothing extra to set up here — Safari is driven by the
      // XCUITest driver itself, where Chrome on Android needs a chromedriver.
      await browser.url(WEB_URL)
      await expect(browser).toHaveUrl(expect.stringContaining('http'))
      return
    }
    if (CUSTOM_APP) {
      // A supplied app has none of Settings' screens, so capture its hierarchy
      // rather than looking for ids that cannot exist.
      expect((await browser.getPageSource()).length).toBeGreaterThan(0)
      return
    }
    // Terminated before activating, not merely activated: Settings remembers
    // the page the last run drilled into, so activating alone would start
    // somewhere unpredictable. This is what makes the spec re-runnable — the
    // iOS equivalent of the Android spec clearing its keypad entry.
    await browser.execute('mobile: terminateApp', { bundleId: APP_ID })
    await browser.execute('mobile: activateApp', { bundleId: APP_ID })
    await expect(await navBarTitle()).toBe('Settings')

    await $('~General').click()
    await browser.waitUntil(async () => (await navBarTitle()) === 'General', {
      timeout: 10000,
      timeoutMsg: 'Settings did not navigate to General'
    })

    // Back through the navigation stack rather than a tap on the back button:
    // that button's accessibility id is the PARENT page's title, so tapping by
    // name hits whichever row happens to share it — measured, it opened About.
    await browser.back()
    await browser.waitUntil(async () => (await navBarTitle()) === 'Settings', {
      timeout: 10000,
      timeoutMsg: 'Settings did not navigate back'
    })
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

    await browser.execute('mobile: activateApp', { bundleId: APP_ID })
    await expect(await navBarTitle()).toBe('Settings')
  })
})
