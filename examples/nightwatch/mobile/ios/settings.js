// Nightwatch against Appium, iOS. The Android example is a sibling spec in
// ../android — a separate file rather than a branch, because the two platforms
// ship different apps and share no selectors.
//
// Drives **Settings**, not Clock. Clock is simply not installed on the iOS
// simulator: `xcrun simctl listapps` lists Settings, Calendar, Reminders, Maps,
// Safari and a handful more, and no `com.apple.mobiletimer`. Settings is on
// every simulator and every real device, so this needs no .app, no upload and
// no credentials — the same property that makes Clock the Android choice.
//
// VERIFIED ON: iOS Simulator `iPhone 17 Pro`, iOS 26.5 (23F77), Xcode 26.

const APP_ID = 'com.apple.Preferences'

/** The navigation bar's title, which is how Settings says where it is. */
async function navBarTitle(browser) {
  const bars = await browser.findElements({
    selector: 'XCUIElementTypeNavigationBar',
    locateStrategy: 'class name'
  })
  if (!bars.length) {
    return ''
  }
  return (await browser.elementIdAttribute(bars[0].getId(), 'name')) ?? ''
}

describe('Settings (native)', function () {
  it('navigates into a settings page and back', async function (browser) {
    // Terminated before activating, not merely activated: Settings remembers
    // the page the last run drilled into, so activating alone would start
    // somewhere unpredictable. This is what makes the spec re-runnable.
    await browser.execute('mobile: terminateApp', [{ bundleId: APP_ID }])
    await browser.execute('mobile: activateApp', [{ bundleId: APP_ID }])
    await browser.assert.ok(
      (await navBarTitle(browser)).includes('Settings'),
      'Settings opened at its root'
    )

    await browser.click({
      selector: 'General',
      locateStrategy: 'accessibility id'
    })
    await browser.waitUntil(
      async () => (await navBarTitle(browser)).includes('General'),
      { timeout: 10000 }
    )

    // Back through the navigation stack rather than a tap on the back button:
    // that button's accessibility id is the PARENT page's title, so tapping by
    // name hits whichever row happens to share it — measured, it opened About.
    await browser.back()
    await browser.waitUntil(
      async () => (await navBarTitle(browser)).includes('Settings'),
      { timeout: 10000 }
    )
  })

  it('captures a second action on the same session', async function (browser) {
    // A second test, so `traceGranularity: 'test'` has two slices to key.
    await browser.execute('mobile: activateApp', [{ bundleId: APP_ID }])
    await browser.assert.ok(
      (await navBarTitle(browser)).includes('Settings'),
      'Settings is foregrounded'
    )
  })
})
