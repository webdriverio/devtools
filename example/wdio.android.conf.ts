// Prerequisites:
//   1. Appium server running: appium --use-drivers=uiautomator2
//   2. Android emulator booted: emulator -avd <name> (device name: emulator-5554)
//   3. Set APP to your APK path, e.g.:
//      curl -L -o /tmp/ApiDemos-debug.apk https://github.com/appium/appium/raw/master/packages/appium/sample-code/apps/ApiDemos-debug.apk
//      export APP=/tmp/ApiDemos-debug.apk
import path from 'node:path'
import * as process from 'node:process'

export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: ['./specs/android.*.ts'],
  tsConfigPath: path.resolve(process.cwd(), './tsconfig.json'),
  maxInstances: 1,
  // Connect to externally-running Appium server
  hostname: 'localhost',
  port: 4723,
  path: '/',
  capabilities: [
    {
      platformName: 'Android',
      'appium:deviceName': 'emulator-5554',
      'appium:automationName': 'UiAutomator2',
      'appium:app': process.env.APP ?? '/tmp/ApiDemos-debug.apk',
      'appium:noReset': false
    }
  ],
  logLevel: 'info',
  bail: 0,
  waitforTimeout: 15000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  // devtools-service writes wdio-trace-{sessionId}.json here
  outputDir: './traces/android',
  services: [
    [
      'devtools',
      {
        screencast: {
          enabled: true,
          captureFormat: 'jpeg' as const,
          quality: 70
        }
      }
    ],
    [
      'tracing',
      {
        outputDir: './traces/android',
        screenshotQuality: 60
      }
    ]
  ],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    timeout: 60000
  }
}
