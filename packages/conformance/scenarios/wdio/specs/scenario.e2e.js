// The conformance scenario through @wdio/devtools-service: the same tests as every adapter's, in WebdriverIO's idiom.
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
const waitForText = (selector, text) =>
  browser.waitUntil(async () => (await $(selector).getText()) === text, {
    timeout: 2000
  })

describe('conformance', () => {
  it('logs in and reads the greeting', async () => {
    await browser.url(env('CONFORMANCE_LOGIN_URL'))
    await $('#username').setValue('tom')
    await $('#password').setValue('secret')
    await $('button[type="submit"]').click()
    await $('#flash').waitForExist({ timeout: 2000 })
    const greeting = await $('#flash').getText()
    assert.equal(greeting, 'You logged into a secure area!')
  })

  it('waits on what the page shows', async () => {
    const greeting = await $('#flash').getText()
    await browser.waitUntil(
      async () =>
        (await $('#flash').getText()) !== '' &&
        (await $('h2').getText()) !== '',
      { timeout: 2000 }
    )
    await waitForText('#flash', greeting)
    await $('#logout').click()
  })

  it('fails on the wrong heading', async () => {
    const heading = await $('h2').getText()
    assert.equal(heading, 'Secure Area')
  })

  it('times out waiting for a missing element', async () => {
    await $('#missing').waitForExist({ timeout: 300 })
  })

  it('survives a refused navigation', async () => {
    try {
      await browser.url(env('CONFORMANCE_BROKEN_URL'))
    } catch {
      // The failed navigation is part of the scenario.
    }
  })
})
