// Simple import - just require the package
const path = require('node:path')
const nightwatchDevtools = require('@wdio/nightwatch-devtools').default
const { cucumberHooksPath } = require('@wdio/nightwatch-devtools')

const featuresDir = path.resolve(__dirname, 'features')

module.exports = {
  // Resolve relative to this config file so the paths hold regardless of CWD.
  src_folders: [path.resolve(featuresDir, 'step_definitions')],
  output_folder: false, // Skip generating nightwatch reports for this example
  custom_commands_path: [],
  custom_assertions_path: [],

  test_runner: {
    type: 'cucumber',
    options: {
      feature_path: featuresDir,
      // Registers the DevTools Before/After/Step scenario hooks so the plugin
      // sees each scenario as a test unit.
      require: [cucumberHooksPath]
    }
  },

  webdriver: {
    start_process: true,
    // server_path: '/opt/homebrew/bin/chromedriver',
    port: 9515
  },

  test_settings: {
    default: {
      // Ensure all tests run even if one fails
      skip_testcases_on_fail: false,

      desiredCapabilities: {
        browserName: 'chrome',
        // Required for chromedriver to expose the BiDi WebSocket channel.
        // Without this, attachBidiHandlers silently fails and the perf-log
        // fallback takes over.
        webSocketUrl: true,
        'goog:chromeOptions': {
          args: [
            '--headless',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--window-size=1600,900'
          ]
        },
        'goog:loggingPrefs': { performance: 'ALL' }
      },
      // bidi: opt-in WebDriver BiDi capture for console + network. When
      // attached, the per-command Chrome perf-log network path is gated off to
      // avoid duplicate entries.
      globals: nightwatchDevtools({
        port: 3000,
        // Cucumber exposes per-scenario hooks, so each scenario is captured as
        // its own test unit. Trace when the harness sets DEVTOOLS_MODE=trace,
        // otherwise stream live to the backend/UI.
        mode: process.env.DEVTOOLS_MODE === 'trace' ? 'trace' : 'live',
        // 'test' (not 'session'): Nightwatch quits the browser per scenario, so a
        // single run-end session write has no live session. Per-scenario 'test'
        // slices flush a zip at each scenario's pre-quit hook, while the session
        // is still alive.
        traceGranularity: 'session',
        bidi: true
      })
    }
  }
}
