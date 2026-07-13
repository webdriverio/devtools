import type { Options } from '@wdio/types'

// Mocha counterpart to wdio.conf.ts (which runs the Cucumber example). Same
// capabilities and devtools service; only the framework + spec layout differ.
export const config: Options.Testrunner = {
  runner: 'local',
  autoCompileOpts: {
    autoCompile: true,
    tsNodeOpts: {
      project: './tsconfig.json',
      transpileOnly: true
    }
  },
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
        // ── Config ladder — change ONLY this block per rung ──────────────
        // 1 live:     mode: 'live'
        // 2 trace:    mode: 'trace'
        // 3 per-test: mode: 'trace', traceGranularity: 'test'
        // 4 fail:     mode: 'trace', traceGranularity: 'test', tracePolicy: 'retain-on-failure'
        // 5 retry:    use `pnpm demo:wdio:retry` (adds retries:1 + on-first-retry)
        mode: 'live' as const
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
