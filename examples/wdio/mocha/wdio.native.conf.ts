// Native-app variant of wdio.trace.conf.ts: drives a preinstalled Android app
// over Appium, so a trace can be produced from a session that has NO document —
// the path where the per-action snapshot reads page-source XML instead of
// running page scripts. The mobile-WEB variant lives in
// cucumber/wdio.mobile.conf.ts; that one drives Chrome on the device and takes
// the web capture path, so the two are not interchangeable.
//
// Prerequisites: an Appium server with the UiAutomator2 driver
// (`appium driver install uiautomator2`) and an emulator or device attached.
// The endpoint and device come from the environment, so a remote host works:
//
//   APPIUM_HOST=100.69.254.5 APPIUM_PORT=4723 pnpm native
//
// No APK is needed — the spec launches a preinstalled app itself. Set
// APPIUM_APP to a bundle path or URL to install one instead.
export const config: WebdriverIO.Config = {
  runner: 'local',

  // Native specs live in their own folder so the web configs' `./specs/**`
  // glob can't pick them up — they drive Appium, not a browser.
  specs: ['./native/**/*.e2e.ts'],
  exclude: [],

  hostname: process.env.APPIUM_HOST ?? '127.0.0.1',
  port: Number(process.env.APPIUM_PORT ?? 4723),
  path: '/',

  maxInstances: 1,
  capabilities: [
    {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': process.env.APPIUM_DEVICE ?? 'emulator-5554',
      // Keep whatever the app already has on the device — this example drives
      // an app it did not install.
      'appium:noReset': true,
      ...(process.env.APPIUM_APP ? { 'appium:app': process.env.APPIUM_APP } : {}),
      // Appium's BiDi shim for UiAutomator2 doesn't implement every BiDi
      // command (e.g. script.addPreloadScript), so keep WDIO on classic.
      'wdio:enforceWebDriverClassic': true
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any,

  logLevel: 'warn',
  bail: 0,
  waitforTimeout: 15000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  services: [
    [
      'devtools',
      {
        // Trace by default; DEVTOOLS_MODE=live gives the same spec a baseline to
        // measure the capture cost against.
        mode: (process.env.DEVTOOLS_MODE === 'live' ? 'live' : 'trace') as
          | 'live'
          | 'trace',
        traceGranularity: (process.env.DEVTOOLS_TRACE_GRANULARITY ??
          'session') as 'session' | 'spec' | 'test',
        tracePolicy: (process.env.DEVTOOLS_TRACE_POLICY ?? 'on') as
          | 'on'
          | 'retain-on-failure'
          | 'retain-on-first-failure',
        // Off by default because a native session has no CDP: the recorder
        // falls back to polling `takeScreenshot` on an interval, which against a
        // phone is a second, competing source of driver round trips. Set
        // DEVTOOLS_FILMSTRIP=on to record one anyway.
        filmstrip: process.env.DEVTOOLS_FILMSTRIP === 'on',
        emitArtifactsManifest: true
      }
    ]
  ],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 120000
  }
}
