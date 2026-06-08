/**
 * Smoke test for @wdio/selenium-devtools.
 *
 * Run from the package root:  pnpm example:mocha
 */

import { strict as assert } from 'node:assert'
import { Builder, By, until } from 'selenium-webdriver'
import { DevTools } from '@wdio/selenium-devtools'

DevTools.configure({
  mode: 'trace',
  screencast: { enabled: true, quality: 70, maxWidth: 1280, maxHeight: 720 },
  headless: true
})

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
})
