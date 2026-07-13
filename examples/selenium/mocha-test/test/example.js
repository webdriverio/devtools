/**
 * Example + config-sweep harness for @wdio/selenium-devtools (Mocha runner).
 *
 * Walk the live/trace ladder by editing ONLY the DevTools.configure({...})
 * block below. The suite carries a passing pair, an always-failing test (for
 * retain-on-failure), and a flaky fail-then-pass test with a per-test retry
 * (for on-first-retry / attempt capture).
 *
 * Run from the package root:  pnpm example:mocha
 */

import { strict as assert } from 'node:assert'
import { Builder, By, until } from 'selenium-webdriver'
import { DevTools } from '@wdio/selenium-devtools'

// ── Config ladder — change this block per rung ──────────────────────────────
// 1 live:    { mode: 'live' }
// 2 trace:   { mode: 'trace' }
// 3 per-test:{ mode: 'trace', traceGranularity: 'test' }
// 4 fail:    { mode: 'trace', traceGranularity: 'test', tracePolicy: 'retain-on-failure' }
// 5 retry:   { mode: 'trace', traceGranularity: 'test', tracePolicy: 'on-first-retry' }
DevTools.configure({
  mode: 'trace',
  // traceGranularity: 'test',
  // tracePolicy: 'on-first-retry',
  headless: true
})

// Survives Mocha's in-process retry so the flaky test fails once, then passes.
let flakyAttempts = 0

describe('selenium-devtools smoke test', function () {
  let driver

  before(async function () {
    driver = await new Builder().forBrowser('chrome').build()
  })

  after(async function () {
    if (driver) {
      await driver.quit()
    }
  })

  it('loads example.com and reads the heading', async function () {
    await driver.get('https://example.com')
    await driver.sleep(1500)
    const heading = await driver.wait(until.elementLocated(By.css('h1')), 10000)
    const text = await heading.getText()
    assert.equal(text, 'Example Domain')
  })

  it('navigates and reads the page title', async function () {
    await driver.get('https://example.org')
    await driver.sleep(1500)
    const title = await driver.getTitle()
    assert.match(title, /Example/i)
  })

  it('fails on a wrong heading (retain-on-failure target)', async function () {
    await driver.get('https://example.com')
    await driver.sleep(1000)
    const heading = await driver.wait(until.elementLocated(By.css('h1')), 10000)
    const text = await heading.getText()
    assert.equal(text, 'This Is Not The Heading')
  })

  it('flaky: fails the first attempt, then passes (retry target)', async function () {
    this.retries(1)
    await driver.get('https://example.com')
    await driver.sleep(1000)
    flakyAttempts += 1
    if (flakyAttempts === 1) {
      throw new Error('intentional first-attempt failure — should retry')
    }
    const title = await driver.getTitle()
    assert.match(title, /Example/i)
  })
})
