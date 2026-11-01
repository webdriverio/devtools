// WebdriverIO config for the conformance scenario: the harness supplies the fake
// WebDriver, and the service's launcher attaches to the recording backend
// through the reuse handshake instead of starting its own.
const webdriver = process.env.CONFORMANCE_WEBDRIVER
if (!webdriver) {
  throw new Error(
    'CONFORMANCE_WEBDRIVER is not set; run this through the conformance harness'
  )
}
const { hostname, port } = new URL(webdriver)

export const config = {
  runner: 'local',
  specs: ['./specs/*.e2e.js'],
  maxInstances: 1,
  hostname,
  port: Number(port),
  path: '/',
  protocol: 'http',
  capabilities: [{ browserName: 'chrome' }],
  logLevel: 'warn',
  bail: 0,
  waitforTimeout: 5000,
  connectionRetryTimeout: 10000,
  connectionRetryCount: 0,
  services: [['devtools', { mode: 'live' }]],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 30000 }
}
