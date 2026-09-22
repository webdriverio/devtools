// Mobile example for the WDIO service. Drives the device's own Settings app by
// default, so it needs no .apk — see ../../MOBILE.md for prerequisites and the
// DEVTOOLS_MOBILE / APPIUM_APP switches.
//
//   pnpm demo:wdio:mobile
//   DEVTOOLS_MODE=live pnpm demo:wdio:mobile

import path from 'node:path'

import { createRequire } from 'node:module'

import { mobileCapabilities } from './capabilities.js'

const { requireMobileToolchain } = createRequire(import.meta.url)(
  '../../mobile-preflight.cjs'
)

const MODE = process.env.DEVTOOLS_MODE === 'live' ? 'live' : 'trace'

const __dirname = path.resolve(path.dirname(new URL(import.meta.url).pathname))

export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: [path.resolve(__dirname, 'specs', '*.e2e.ts')],

  // Appium, not a local browser driver.
  hostname: process.env.APPIUM_HOST ?? '127.0.0.1',
  port: Number(process.env.APPIUM_PORT ?? 4723),
  path: '/',

  maxInstances: 1,
  // `wdio:enforceWebDriverClassic` is honored at runtime but not yet in
  // @wdio/types: Appium's BiDi shim for UiAutomator2 does not implement every
  // BiDi command (`script.addPreloadScript` among them), and the service falls
  // back cleanly only if it is not told BiDi is available.
  capabilities: [
    {
      ...mobileCapabilities(),
      'wdio:enforceWebDriverClassic': true
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any,

  logLevel: 'warn',
  bail: 0,
  waitforTimeout: 20000,
  connectionRetryTimeout: 180000,
  connectionRetryCount: 3,

  services: [
    [
      'devtools',
      {
        // Trace by default, matching the desktop demos. An inherited
        // DEVTOOLS_MODE=live silently changes what a run produces — a UI window
        // and no zip instead of a zip and no window — so the mode is logged.
        mode: MODE,
        traceGranularity: 'test',
        // Filmstrip is OPT-IN on mobile, unlike the desktop demos, purely on
        // cost: the poller takes a screenshot every interval and a real device
        // screenshot is slow — a 3-command run against an emulator took 45 s.
        //
        // NOT because it crashes the UiAutomator2 instrumentation. That crash
        // does happen on an API 36 emulator, but it happens with the poller off
        // and at session creation too, so it is the image or the driver rather
        // than anything here — see examples/MOBILE.md.
        ...(process.env.DEVTOOLS_FILMSTRIP === '1'
          ? { filmstrip: true, screencast: { pollIntervalMs: 2000 } }
          : {})
      }
    ]
  ],

  // Before any worker opens a session, so a missing emulator or Appium reads as
  // a prerequisite rather than as "make sure browser driver is running".
  onPrepare: async () => {
    console.log(
      `devtools mobile: ${MODE} mode` +
        (MODE === 'live'
          ? ' — opens the dashboard, writes no trace zip'
          : ' — writes a trace zip to test-results/, opens no window')
    )
    await requireMobileToolchain()
  },

  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 180000 }
}
