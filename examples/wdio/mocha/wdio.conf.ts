// WebdriverIO + Mocha. The Cucumber example beside this one uses the same
// capabilities and the same service block; only the framework and the spec
// layout differ.
//
// Every devtools option below reads from the environment, so ONE config walks
// the whole live→trace→per-test→retention ladder without being edited:
//
//   pnpm demo:wdio:mocha                                    live
//   DEVTOOLS_MODE=trace pnpm demo:wdio:mocha                one zip per run
//   DEVTOOLS_MODE=trace DEVTOOLS_TRACE_GRANULARITY=test …   one zip per test
//   … DEVTOOLS_TRACE_POLICY=retain-on-failure               keep only failures
//
// Retries are the one rung that needs its own config, because they change the
// runner and not just the service: `pnpm demo:wdio:retry`.
export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: ['./specs/**/*.e2e.ts'],
  exclude: [],
  // Live mode drives a single-session dashboard; >1 worker streams two sessions
  // into it at once and neither renders cleanly. One instance = readable demo.
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'chrome',
      'goog:chromeOptions': {
        args: [
          '--headless',
          '--disable-gpu',
          '--remote-allow-origins=*',
          '--window-size=1600,900'
        ]
      }
    }
  ],
  logLevel: 'warn',
  bail: 0,
  baseUrl: 'http://localhost',
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  services: [
    [
      'devtools',
      {
        mode: (process.env.DEVTOOLS_MODE === 'trace' ? 'trace' : 'live') as
          'live' | 'trace',
        traceGranularity: (process.env.DEVTOOLS_TRACE_GRANULARITY ??
          'session') as 'session' | 'spec' | 'test',
        tracePolicy: (process.env.DEVTOOLS_TRACE_POLICY ?? 'on') as
          | 'on'
          | 'retain-on-failure'
          | 'retain-on-first-failure'
          | 'on-first-retry'
          | 'on-all-retries'
          | 'retain-on-failure-and-retries',
        // Always emitted, so the artifact set is inspectable for any rung.
        emitArtifactsManifest: true
      }
    ]
  ],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000
  }
}
