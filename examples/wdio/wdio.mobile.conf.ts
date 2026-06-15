// Mobile-web (Android Chrome via Appium) variant of wdio.conf.ts.
//
// Prerequisites:
//   1. Appium 2.x running locally: `appium --address 127.0.0.1 --port 4723`
//   2. UiAutomator2 driver installed: `appium driver install uiautomator2`
//   3. An Android emulator running with Chrome installed
//      (or a real device with USB debugging on and `adb devices` listing it).
//
// Run (from inside examples/wdio):
//   pnpm mobile
//
// The DevTools service detects `platformName: Android|iOS` via shared
// capabilities and adjusts the action-snapshot probe (mobile XML element
// extraction) and the trace's context naming accordingly.

import path from 'node:path'
import type { Options } from '@wdio/types'

const __dirname = path.resolve(path.dirname(new URL(import.meta.url).pathname))

export const config: Options.Testrunner = {
  runner: 'local',

  specs: ['./features/**/*.feature'],
  exclude: [],

  hostname: '127.0.0.1',
  port: 4723,
  path: '/',

  maxInstances: 1,
  // `wdio:enforceWebDriverClassic` isn't in @wdio/types yet but is honored
  // at runtime — needed because Appium's BiDi shim for UiAutomator2 doesn't
  // implement every BiDi command (e.g. script.addPreloadScript).
  capabilities: [
    {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': 'emulator-5554',
      browserName: 'Chrome',
      'appium:chromedriverAutodownload': true,
      'wdio:enforceWebDriverClassic': true
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any,

  logLevel: 'info',
  bail: 0,
  baseUrl: 'http://localhost',
  waitforTimeout: 15000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  services: [
    [
      'devtools',
      {
        mode: 'trace' as const,
        screencast: { enabled: true, pollIntervalMs: 250 }
      }
    ]
  ],
  framework: 'cucumber',
  reporters: ['spec'],
  cucumberOpts: {
    require: [
      path.resolve(__dirname, 'features', 'step-definitions', 'steps.ts')
    ],
    backtrace: false,
    requireModule: [],
    dryRun: false,
    failFast: false,
    snippets: true,
    source: true,
    strict: false,
    tagExpression: '',
    timeout: 90000,
    ignoreUndefinedDefinitions: false
  }
}
