import path from 'node:path'

// Disposable harness for verifying tracePolicy end-to-end. Runs one passing
// spec (login.feature) and one failing spec (login-fail.feature) at spec
// granularity so retain-on-failure can be seen dropping the passing spec's
// trace while keeping the failing one. Change `tracePolicy` below to try each.

const __dirname = path.resolve(path.dirname(new URL(import.meta.url).pathname))

export const config: WebdriverIO.Config = {
  runner: 'local',
  tsConfigPath: './tsconfig.json',

  specs: ['./features/login.feature', './features/login-fail.feature'],

  maxInstances: 1,

  capabilities: [
    {
      browserName: 'chrome',
      browserVersion: '149.0.7827.201', // specify chromium browser version for testing
      'goog:chromeOptions': {
        args: [
          '--headless',
          '--disable-gpu',
          '--remote-allow-origins=*',
          '--window-size=1600,1200'
        ]
      }
    }
  ],

  logLevel: 'warn',
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
    timeout: 60000,
    ignoreUndefinedDefinitions: false
  }
}
