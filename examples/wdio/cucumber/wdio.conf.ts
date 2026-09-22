// WebdriverIO + Cucumber. The Mocha example beside this one uses the same
// capabilities and the same service block; only the framework and the spec
// layout differ.
//
// Every devtools option below reads from the environment, so ONE config walks
// the whole live→trace→per-test→retention ladder without being edited:
//
//   pnpm demo:wdio                                          live
//   DEVTOOLS_MODE=trace pnpm demo:wdio                      one zip per run
//   DEVTOOLS_MODE=trace DEVTOOLS_TRACE_GRANULARITY=test …   one zip per test
//   … DEVTOOLS_TRACE_POLICY=retain-on-failure               keep only failures
//
// Retention is easiest to SEE with a failing spec beside a passing one, which
// is what `pnpm demo:wdio:retention` runs — same config, both features.
import path from 'node:path'

const __dirname = path.resolve(path.dirname(new URL(import.meta.url).pathname))

export const config: WebdriverIO.Config = {
  runner: 'local',
  // DEVTOOLS_SPECS=all adds the deliberately failing feature, so a retention
  // policy can be watched dropping one trace and keeping the other.
  specs:
    process.env.DEVTOOLS_SPECS === 'all'
      ? ['./features/**/*.feature']
      : ['./features/login.feature'],
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
          '--window-size=1600,900',
          // Chrome stops delivering synthesized input to a tab once a breached
          // credential is submitted, which silently kills every later click.
          // Pointing the check at localhost is what keeps the demo working.
          '--host-resolver-rules=MAP passwordsleakcheck-pa.googleapis.com 127.0.0.1'
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
  framework: 'cucumber',
  reporters: [
    'spec',
    [
      'allure',
      {
        outputDir: path.resolve(__dirname, 'allure-results'),
        // Trace mode issues a takeScreenshot (+ reads) per action to build the
        // trace snapshots; @wdio/allure-reporter logs every WebDriver command as
        // a step and attaches a screenshot per takeScreenshot, which floods the
        // report. Silence both — the trace.zip attachment is unaffected, and the
        // gherkin Given/When/Then steps still show.
        disableWebdriverStepsReporting: true,
        disableWebdriverScreenshotsReporting: true
      }
    ]
  ],
  cucumberOpts: {
    require: [
      path.resolve(__dirname, 'features', 'step-definitions', 'steps.ts')
    ],
    timeout: 60000
  }
}
