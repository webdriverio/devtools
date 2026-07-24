// Simple import - just require the package
const path = require('node:path')
const nightwatchDevtools = require('@wdio/nightwatch-devtools').default

module.exports = {
  // Resolve relative to this config file so the path holds regardless of CWD.
  src_folders: [path.resolve(__dirname, 'tests')],
  output_folder: false, // Skip generating nightwatch reports for this example
  // Add custom reporter to capture commands
  custom_commands_path: [],
  custom_assertions_path: [],

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
        // ── Config ladder — change ONLY this block per rung ───────────────
        // 1 live:     mode: 'live'
        // 2 trace:    mode: 'trace'
        // 3 per-test: mode: 'trace', traceGranularity: 'test'
        // 4 fail:     mode: 'trace', traceGranularity: 'test', tracePolicy: 'retain-on-failure'
        // 5 retry:    mode: 'trace', traceGranularity: 'test', tracePolicy: 'on-first-retry'
        //             (rung 5 needs retries → run `pnpm demo:nightwatch:retry`)
        // NOTE: the BDD describe/it interface fires the plugin's beforeEach once
        // per module (no per-`it` hook), so traceGranularity:'test' collapses to
        // a single session-scoped slice here. See CLAUDE.md § Known debt.
        mode: 'trace',
        traceGranularity: 'session',
        // tracePolicy: 'retain-on-first-failure',
        bidi: true
      })
    }
  }
}
