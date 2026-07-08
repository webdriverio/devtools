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
  maxInstances: 10,
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
  logLevel: 'debug',
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
        traceGranularity: 'spec' as const
        // tracePolicy: 'retain-on-failure' as const
        // screencast: { enabled: true, pollIntervalMs: 200 }
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
