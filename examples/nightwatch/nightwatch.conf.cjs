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
        'goog:chromeOptions': {
          args: [
            '--headless',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--window-size=1600,1200'
          ]
        },
        'goog:loggingPrefs': { performance: 'ALL' }
      },
      // Simple configuration - just call the function to get globals.
      // Screencast records a polling-mode .webm via fluent-ffmpeg; the file
      // is written to cwd as nightwatch-video-<sessionId>.webm.
      globals: nightwatchDevtools({
        port: 3000,
        screencast: { enabled: true, pollIntervalMs: 200 }
      })
    }
  }
}
