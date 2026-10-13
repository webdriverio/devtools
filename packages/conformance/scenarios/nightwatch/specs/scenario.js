// The conformance scenario, driven through @wdio/nightwatch-devtools: the same
// steps as every other adapter's scenario, in Nightwatch's own idiom.
const env = (name) => {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set; run this through the conformance harness`
    )
  }
  return value
}

describe('conformance', function () {
  it('drives the fake pages', async function (browser) {
    await browser.url(env('CONFORMANCE_LOGIN_URL'))
    await browser.setValue('#username', 'tom')
    await browser.setValue('#password', 'secret')
    await browser.click('button[type="submit"]')
    await browser.click('#logout')
    try {
      await browser.url(env('CONFORMANCE_BROKEN_URL'))
    } catch {
      // The failed navigation is part of the scenario.
    }
  })
})
