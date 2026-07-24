/**
 * Example + config-sweep harness for @wdio/nightwatch-devtools.
 *
 * Walk the live/trace ladder by editing ONLY the mode/traceGranularity/
 * tracePolicy block in ../nightwatch.conf.cjs. The suite carries a passing
 * pair, an always-failing test (retain-on-failure target), and a flaky
 * fail-then-pass test (on-first-retry / attempt-capture target).
 *
 * Native asserts (browser.assert.*) double as the assertion-capture check:
 * the passing ones must render green ✓, the failing one red ✗.
 *
 * Run from repo root:
 *   pnpm demo:nightwatch          (rungs 1-4)
 *   pnpm demo:nightwatch:retry    (rung 5 — adds --retries 1)
 */

// Survives Nightwatch's testcase retry so the flaky test fails once, then passes.
let flakyAttempts = 0

describe('nightwatch-devtools smoke test', function () {
  it('loads example.com and reads the heading', async function (browser) {
    await browser.url('https://example.com')
    await browser.waitForElementVisible('body', 5000)
    browser.assert.titleContains('Example')
  })

  it('navigates and reads the page title', async function (browser) {
    await browser.url('https://example.org')
    await browser.waitForElementVisible('body', 5000)
    browser.assert.titleContains('Example')
  })

  it('fails on a wrong title (retain-on-failure target)', async function (browser) {
    await browser.url('https://example.com')
    await browser.waitForElementVisible('body', 5000)
    browser.assert.titleContains('This Is Not The Title')
  })

  it('flaky: fails the first attempt, then passes (retry target)', async function (browser) {
    await browser.url('https://example.com')
    await browser.waitForElementVisible('body', 5000)
    flakyAttempts += 1
    if (flakyAttempts === 1) {
      throw new Error('intentional first-attempt failure — should retry')
    }
    browser.assert.titleContains('Example')
  })
})
