import type { Options } from '@wdio/types'

// Disposable harness for verifying B4 (retry-aware trace policies). Runs the
// deterministically-flaky spec (fails once, passes on retry) alongside a clean
// passing spec at spec granularity. With tracePolicy 'on-first-retry' only the
// flaky spec's trace is retained — proving the retry attempt is captured and is
// distinct from failure (the flaky test ends PASSED, so retain-on-failure would
// drop it). Flip tracePolicy below to exercise the other retry-aware policies.
export const config: Options.Testrunner = {
  runner: 'local',
  autoCompileOpts: {
    autoCompile: true,
    tsNodeOpts: {
      project: './tsconfig.json',
      transpileOnly: true
    }
  },
  specs: ['./retry/flaky.e2e.ts', './specs/login.e2e.ts'],
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
        mode: 'trace' as const,
        traceGranularity: 'spec' as const,
        tracePolicy: 'on-first-retry' as const
      }
    ]
  ],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
    // 1 retry = 2 total attempts; the flaky spec fails attempt 0, passes attempt 1.
    retries: 1
  }
}
