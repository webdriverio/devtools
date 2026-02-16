// Simple import - just require the package  
const nightwatchDevtools = require('@wdio/nightwatch-devtools').default;

module.exports = {
  src_folders: ['example/tests'],

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
      desiredCapabilities: {
        browserName: 'chrome',
        'goog:chromeOptions': {
          args: ['--headless', '--no-sandbox', '--disable-dev-shm-usage']
        }
      },
      // Simple configuration - just call the function to get globals
      globals: nightwatchDevtools({ port: 3000 })
    }
  }
};
