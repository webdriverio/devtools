// Trace-mode variant of wdio.conf.ts, for manually verifying trace output. Same
// capabilities and specs as the live config; session granularity writes one zip
// per run. Every knob reads from the environment so one config covers the
// live→trace→per-test→retain→retry ladder. Kept separate so the demo config's
// live default stays untouched.
export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: ['./specs/**/*.e2e.ts'],
  exclude: [],
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
        // Trace by default (regen); DEVTOOLS_MODE=live flips to live for live-parity recording.
        mode: (process.env.DEVTOOLS_MODE === 'live' ? 'live' : 'trace') as
          'live' | 'trace',
        // Granularity/policy default to session/on and are env-overridable so
        // one config can walk the whole grid, e.g.
        //   DEVTOOLS_TRACE_GRANULARITY=test DEVTOOLS_TRACE_POLICY=retain-on-failure
        traceGranularity: (process.env.DEVTOOLS_TRACE_GRANULARITY ??
          'session') as 'session' | 'spec' | 'test',
        tracePolicy: (process.env.DEVTOOLS_TRACE_POLICY ?? 'on') as
          | 'on'
          | 'retain-on-failure'
          | 'retain-on-first-failure'
          | 'on-first-retry'
          | 'on-all-retries'
          | 'retain-on-failure-and-retries',
        // Always emit the manifest so the artifact set is inspectable per run.
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
