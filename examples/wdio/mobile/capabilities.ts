import { createRequire } from 'node:module'

// The one capability set the mobile examples share, so a difference in the
// dashboard between two adapters is a difference in the adapter. The Selenium,
// Nightwatch and Python examples spell the same bag in their own syntax —
// keep the four in step, and see ../../MOBILE.md for what each switch means.

/** The Clock app, which ships with every Android system image and every iOS
 *  device — so a native example needs no .apk or .app uploaded or kept in the
 *  repo. Chosen over Settings because it has a deterministic screen to drive:
 *  a timer can be started, paused and cleared, and each step is observable.
 *
 *  The activity is named here so the session opens on Clock directly, but the
 *  specs still call `mobile: activateApp` — that is what makes them re-runnable
 *  against a session left on another screen, and it needs no adb_shell. */
const CLOCK_APP = {
  android: {
    'appium:appPackage': 'com.google.android.deskclock',
    'appium:appActivity': 'com.android.deskclock.DeskClock'
  },
  ios: { 'appium:bundleId': 'com.apple.Preferences' }
}

const { bootedSimulators } = createRequire(import.meta.url)(
  '../../mobile-preflight.cjs'
) as { bootedSimulators: () => { name: string; udid: string }[] | null }

const IOS = process.env.DEVTOOLS_MOBILE_PLATFORM === 'ios'

/** The simulator to drive, as a udid.
 *
 *  By udid rather than by name, because naming one that does not exist does
 *  NOT fail: the XCUITest driver CREATES it (`appiumTest-<uuid>-<name>`) and
 *  boots it, every run, beside the simulator already running. The default name
 *  used to be a device Xcode no longer ships, so every iOS run left another
 *  simulator behind.
 *
 *  Defaults to whatever is already booted — the iOS counterpart of attaching
 *  to the running emulator on Android. `IOS_DEVICE_NAME` picks among several,
 *  and `IOS_UDID` names one outright. */
function iosDevice(): Record<string, string> {
  if (process.env.IOS_UDID) {
    return { 'appium:udid': process.env.IOS_UDID }
  }
  const booted = bootedSimulators() ?? []
  const wanted = process.env.IOS_DEVICE_NAME
  const match = wanted
    ? booted.find((device) => device.name === wanted)
    : booted[0]
  if (match) {
    return { 'appium:udid': match.udid, 'appium:deviceName': match.name }
  }
  // Nothing booted: fall back to naming one, which is the only thing left —
  // and the preflight has already said so before reaching here.
  return { 'appium:deviceName': wanted ?? 'iPhone 17 Pro' }
}

export function mobileCapabilities(): Record<string, unknown> {
  const web = process.env.DEVTOOLS_MOBILE === 'web'
  const app = process.env.APPIUM_APP

  return {
    platformName: IOS ? 'iOS' : 'Android',
    'appium:automationName': IOS ? 'XCUITest' : 'UiAutomator2',
    // Which simulator, resolved to a udid — see `iosDevice`.
    ...(IOS
      ? {
          ...iosDevice(),
          ...(process.env.IOS_PLATFORM_VERSION
            ? { 'appium:platformVersion': process.env.IOS_PLATFORM_VERSION }
            : {})
        }
      : {}),
    // Leave whatever is installed alone; a full reset costs minutes per run.
    'appium:noReset': true,
    'appium:newCommandTimeout': 300,
    ...(web
      ? {
          // A mobile BROWSER session. It names a browser, which is exactly what
          // tells the adapters it HAS a document and must keep its page-side
          // capture — the native/web distinction this example exists to show.
          // Chrome on the device needs a matching chromedriver. Appium can
          // fetch one, but that is a SERVER feature, not a capability:
          // `--allow-insecure=uiautomator2:chromedriver_autodownload`. There is
          // no `appium:chromedriverAutodownload` capability — the driver only
          // reads `chromedriverExecutable`/`chromedriverExecutableDir`, so
          // passing the other name did nothing at all.
          browserName: IOS ? 'Safari' : 'Chrome',
          // Where autodownload may unpack. Appium's default is inside its own
          // driver tree, which is root-owned after a `sudo npm i -g appium`
          // and then the download succeeds and the UNZIP fails with EACCES —
          // reported as the same "No Chromedriver found" as a missing version.
          ...(process.env.CHROMEDRIVER_DIR
            ? {
                'appium:chromedriverExecutableDir': process.env.CHROMEDRIVER_DIR
              }
            : {}),
          // The exact binary, which skips autodownload entirely — the reliable
          // route when the emulator's Chrome is older than anything the server
          // will fetch. Must be a HOST build (it drives the device over adb).
          ...(process.env.CHROMEDRIVER_EXECUTABLE
            ? {
                'appium:chromedriverExecutable':
                  process.env.CHROMEDRIVER_EXECUTABLE
              }
            : {})
        }
      : app
        ? { 'appium:app': app }
        : IOS
          ? CLOCK_APP.ios
          : CLOCK_APP.android)
  }
}
