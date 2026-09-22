// Mobile example for @wdio/nightwatch-devtools. Drives the device's own
// Clock app that ships with every Android system image, so it needs no .apk.
// See examples/MOBILE.md for
// prerequisites and the DEVTOOLS_MOBILE / APPIUM_APP switches.
//
//   pnpm demo:nightwatch:mobile
//   DEVTOOLS_MODE=live pnpm demo:nightwatch:mobile

const path = require('node:path')
const nightwatchDevtools = require('@wdio/nightwatch-devtools').default
const { requireMobileToolchain } = require('../mobile-preflight.cjs')

const isWeb = process.env.DEVTOOLS_MOBILE === 'web'
const IOS = process.env.DEVTOOLS_MOBILE_PLATFORM === 'ios'

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
    'appium:newCommandTimeout': 300
  }
  if (isWeb) {
    // Names a browser, so this session HAS a document and keeps its page-side
    // capture — the distinction the native guards turn on.
    return {
      ...base,
      // Chrome on the device needs a matching chromedriver. Appium can
      // fetch one, but that is a SERVER feature, not a capability:
      // `--allow-insecure=uiautomator2:chromedriver_autodownload`.
      browserName: IOS ? 'Safari' : 'Chrome'
    }
  }
  if (process.env.APPIUM_APP) {
    return { ...base, browserName: null, 'appium:app': process.env.APPIUM_APP }
  }
  if (IOS) {
    return {
      ...base,
      browserName: null,
      'appium:bundleId': 'com.apple.mobiletimer'
    }
  }
  return {
    ...base,
    // Explicitly NO browser. Without this Nightwatch fills in its default and
    // sends `browserName: "firefox"` plus `moz:firefoxOptions` — measured — and
    // the adapters then correctly treat the session as having a document and
    // run their page-side capture against an app. With `use_appium` set this
    // returns early and does not warn as deprecated.
    browserName: null,
    'appium:appPackage': 'com.google.android.deskclock',
    'appium:appActivity': 'com.android.deskclock.DeskClock'
  }
}

module.exports = {
  src_folders: [path.resolve(__dirname, 'mobile')],
  output_folder: false,
  custom_commands_path: [],
  custom_assertions_path: [],

  // Appium, not a browser driver Nightwatch would start itself. It has to be
  // declared under `selenium` with `use_appium`, not merely pointed at port
  // 4723: Nightwatch picks a transport from `browserName`, and with none it
  // infers GeckoDriver and reports "Failed to connect to GeckoDriver". The
  // older `browserName: null` route still works but warns as deprecated.
  selenium: {
    start_process: false,
    use_appium: true,
    host: process.env.APPIUM_HOST ?? '127.0.0.1',
    port: Number(process.env.APPIUM_PORT ?? 4723),
    // Appium 2 serves the W3C routes at the root; the default prefix is
    // Selenium's `/wd/hub`.
    default_path_prefix: ''
  },
  webdriver: {
    start_process: false
  },

  test_settings: {
    default: {
      skip_testcases_on_fail: false,
      desiredCapabilities: mobileCapabilities(),
      globals: Object.assign(
        nightwatchDevtools({
          port: 3000,
          // Trace by default, matching the desktop demos.
          mode: process.env.DEVTOOLS_MODE === 'live' ? 'live' : 'trace',
          // The BDD describe/it interface fires the plugin's beforeEach once per
          // MODULE, so per-test slicing collapses to one session-scoped slice
          // here regardless — see CLAUDE.md § Known debt.
          traceGranularity: 'session',
          // Appium serves no BiDi, so leave it off rather than have the attach
          // fail once per run; the perf-log fallback covers a mobile-web session.
          bidi: false
        }),
        {
          // Nightwatch reports a missing Appium as a GeckoDriver failure, which
          // names neither the cause nor the fix.
          before: async () => requireMobileToolchain()
        }
      )
    }
  }
}
