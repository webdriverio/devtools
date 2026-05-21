import path from 'node:path'
import * as process from 'node:process'

export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: ['./specs/chrome.*.ts'],
  tsConfigPath: path.resolve(process.cwd(), './tsconfig.json'),
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'chrome',
      'goog:chromeOptions': {
        args: [
          '--headless',
          '--window-size=1600,1200',
          '--remote-allow-origins=*'
        ]
      }
    }
  ],
  logLevel: 'info',
  bail: 0,
  baseUrl: 'https://www.worldofbooks.com',
  waitforTimeout: 15000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  outputDir: './traces/chrome',
  services: [
    // [
    //   'devtools',
    //   {
    //     screencast: {
    //       enabled: true,
    //       captureFormat: 'jpeg' as const,
    //       quality: 70,
    //     }
    //   }
    // ],
    [
      'tracing',
      {
        outputDir: './traces/chrome',
        screenshotQuality: 60
      }
    ]
  ],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    timeout: 180000
  }
}
