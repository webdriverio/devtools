// Simple import - just require the package
const nightwatchDevtools = require('@wdio/nightwatch-devtools').default

module.exports = {
  src_folders: ['example/tests'],
  output_folder: false, // Skip generating nightwatch reports for this example
  // Add custom reporter to capture commands
  custom_commands_path: [],
  custom_assertions_path: [],

  webdriver: {
    start_process: true,
    server_path: '/opt/homebrew/bin/chromedriver',
    port: 9515
  },

  test_settings: {
    default: {
      // Ensure all tests run even if one fails
      skip_testcases_on_fail: false,

      desiredCapabilities: {
        browserName: 'chrome',
        'goog:chromeOptions': {
          args: ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--window-size=1600,1200']
        },
        'goog:loggingPrefs': { performance: 'ALL' }
      },
      // Simple configuration - just call the function to get globals
      globals: nightwatchDevtools({ port: 3000 })
    }
  }
}
