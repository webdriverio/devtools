import path from 'node:path'

const __dirname = path.resolve(path.dirname(new URL(import.meta.url).pathname))

export const config: WebdriverIO.Config = {
  runner: 'local',
  tsConfigPath: './tsconfig.json',

  specs: ['./features/login.feature'],

  maxInstances: 1,

  capabilities: [
    {
      browserName: 'chrome',
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
        traceFormat: 'zip'
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
