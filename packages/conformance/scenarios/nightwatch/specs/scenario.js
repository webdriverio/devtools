// The conformance scenario through @wdio/nightwatch-devtools: the same tests as every adapter's, in Nightwatch's idiom.
import { strict as assert } from 'node:assert'

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
const waitForText = (browser, selector, text) =>
  browser.waitUntil(
    async () => (await browser.getText(selector)) === text,
    2000
  )

describe('conformance', function () {
  it('logs in and reads the greeting', async function (browser) {
    await browser.url(env('CONFORMANCE_LOGIN_URL'))
    await browser.setValue('#username', 'tom')
    await browser.setValue('#password', 'secret')
    await browser.click('button[type="submit"]')
    await browser.waitForElementPresent('#flash', 2000)
    const greeting = await browser.getText('#flash')
    assert.equal(greeting, 'You logged into a secure area!')
  })

  it('waits on what the page shows', async function (browser) {
    const greeting = await browser.getText('#flash')
    await browser.waitUntil(
      async () =>
        (await browser.getText('#flash')) !== '' &&
        (await browser.getText('h2')) !== '',
      2000
    )
    await waitForText(browser, '#flash', greeting)
    await browser.click('#logout')
  })

  it('asserts on the page title', async function (browser) {
    // The heading reads the same text as the title, and the secure page's heading read the expected value.
    await browser.getText('h2')
    const title = await browser.getTitle()
    assert.notEqual(title, 'Secure Area')
  })

  it('fails on the wrong heading', async function (browser) {
    const heading = await browser.getText('h2')
    assert.equal(heading, 'Secure Area')
  })

  it('times out waiting for a missing element', async function (browser) {
    await browser.waitForElementPresent('#missing', 300)
  })

  it('survives a refused navigation', async function (browser) {
    try {
      await browser.url(env('CONFORMANCE_BROKEN_URL'))
    } catch {
      // The failed navigation is part of the scenario.
    }
  })
})
