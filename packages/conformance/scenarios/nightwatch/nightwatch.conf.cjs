// Nightwatch config for the conformance scenario: the harness supplies the fake
// WebDriver and reaches the recording backend through the reuse handshake.
const path = require('node:path')
const nightwatchDevtools = require('@wdio/nightwatch-devtools').default

const webdriver = process.env.CONFORMANCE_WEBDRIVER
if (!webdriver) {
  throw new Error(
    'CONFORMANCE_WEBDRIVER is not set; run this through the conformance harness'
  )
}
const { hostname, port } = new URL(webdriver)

module.exports = {
  src_folders: [path.resolve(__dirname, 'specs')],
  output_folder: false,
  webdriver: { start_process: false, host: hostname, port: Number(port) },
  test_settings: {
    default: {
      skip_testcases_on_fail: false,
      desiredCapabilities: { browserName: 'chrome', webSocketUrl: true },
      globals: nightwatchDevtools({ mode: 'live', bidi: true })
    }
  }
}
