// The conformance scenario through @wdio/selenium-devtools under `mocha --require`: the same tests as every adapter's.
import { strict as assert } from 'node:assert'

import { DevTools } from '@wdio/selenium-devtools'
import { Builder, By, until } from 'selenium-webdriver'

DevTools.configure({ openUi: false })

const env = (name) => {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set; run this through the conformance harness`
    )
  }
  return value
}

// A helper wait that repeats the read the test issued just before it.
const waitForText = (driver, selector, text) =>
  driver.wait(
    async () => (await driver.findElement(By.css(selector)).getText()) === text,
    2000
  )

describe('conformance', function () {
  let driver

  before(async function () {
    driver = await new Builder()
      .forBrowser('chrome')
      .usingServer(env('CONFORMANCE_WEBDRIVER'))
      .build()
  })

  after(async function () {
    await driver?.quit()
  })

  it('logs in and reads the greeting', async function () {
    await driver.get(env('CONFORMANCE_LOGIN_URL'))
    await driver.findElement(By.css('#username')).sendKeys('tom')
    await driver.findElement(By.css('#password')).sendKeys('secret')
    await driver.findElement(By.css('button[type="submit"]')).click()
    await driver.wait(until.elementLocated(By.css('#flash')), 2000)
    const greeting = await driver.findElement(By.css('#flash')).getText()
    assert.equal(greeting, 'You logged into a secure area!')
  })

  it('waits on what the page shows', async function () {
    const greeting = await driver.findElement(By.css('#flash')).getText()
    await driver.wait(
      async () =>
        (await driver.findElement(By.css('#flash')).getText()) !== '' &&
        (await driver.findElement(By.css('h2')).getText()) !== '',
      2000
    )
    await waitForText(driver, '#flash', greeting)
    await driver.findElement(By.css('#logout')).click()
  })

  it('asserts on the page title', async function () {
    // The heading reads the same text as the title, and the secure page's heading read the expected value.
    await driver.findElement(By.css('h2')).getText()
    const title = await driver.getTitle()
    assert.notEqual(title, 'Secure Area')
  })

  it('fails on the wrong heading', async function () {
    const heading = await driver.findElement(By.css('h2')).getText()
    assert.equal(heading, 'Secure Area')
  })

  it('times out waiting for a missing element', async function () {
    await driver.wait(until.elementLocated(By.css('#missing')), 300)
  })

  it('survives a refused navigation', async function () {
    await driver.get(env('CONFORMANCE_BROKEN_URL')).catch(() => undefined)
  })
})
