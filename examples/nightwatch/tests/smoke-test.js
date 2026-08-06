/**
 * Example + config-sweep harness for @wdio/nightwatch-devtools.
 *
 * Exercises the same the-internet login flow the WDIO and Selenium examples
 * use, so a trace captured here is comparable across adapters. Walk the
 * live/trace ladder by editing ONLY the mode/traceGranularity/tracePolicy
 * block in ../nightwatch.conf.cjs. The suite carries a passing pair (a login
 * round-trip and a DOM-mutation test), an always-failing test
 * (retain-on-failure target), and a flaky fail-then-pass test
 * (on-first-retry / attempt-capture target).
 *
 * Native asserts (browser.assert.*) double as the assertion-capture check:
 * the passing ones must render green ✓, the failing one red ✗.
 *
 * Run from repo root:
 *   pnpm demo:nightwatch          (rungs 1-4)
 *   pnpm demo:nightwatch:retry    (rung 5 — adds --retries 1)
 */

const BASE_URL = 'https://the-internet.herokuapp.com'

// Survives Nightwatch's testcase retry so the flaky test fails once, then passes.
let flakyAttempts = 0

describe('nightwatch-devtools smoke test', function () {
  it('logs into the secure area with valid credentials', async function (browser) {
    console.log('[TEST] logging in with valid credentials')
    await browser.url(`${BASE_URL}/login`)
    await browser.waitForElementVisible('#username', 5000)
    await browser.setValue('#username', 'tomsmith')
    await browser.setValue('#password', 'SuperSecretPassword!')
    await browser.click('button[type="submit"]')
    await browser.waitForElementVisible('#flash', 5000)
    browser.assert.urlContains('/secure')
    browser.assert.textContains('#flash', 'You logged into a secure area')

    await browser.waitForElementVisible('a[href="/logout"]', 5000)
    await browser.click('a[href="/logout"]')
    await browser.waitForElementVisible('#username', 5000)
    browser.assert.urlContains('/login')
    console.log('[TEST] logged back out')
  })

  it('fails on a wrong flash message (retain-on-failure target)', async function (browser) {
    console.log('[TEST] submitting invalid credentials')
    await browser.url(`${BASE_URL}/login`)
    await browser.waitForElementVisible('#username', 5000)

    // 1. Explicitly click the input to gain browser focus
    await browser.click('#username')
    await browser.clearValue('#username')
    await browser.setValue('#username', 'foobar')

    // 2. Explicitly click the password input to move focus safely
    await browser.click('#password')
    await browser.clearValue('#password')
    await browser.setValue('#password', 'barfoo')

    await browser.click('button[type="submit"]')
    await browser.waitForElementVisible('#flash', 5000)
    browser.assert.textContains('#flash', 'You logged into a secure area')
  })

  it('flaky: fails the first attempt, then passes (retry target)', async function (browser) {
    await browser.url(`${BASE_URL}/login`)
    await browser.waitForElementVisible('#username', 5000)
    flakyAttempts += 1
    if (flakyAttempts === 1) {
      throw new Error('intentional first-attempt failure — should retry')
    }
    browser.assert.titleContains('The Internet')
  })
})
