// The conformance scenario, driven through @wdio/devtools-service: the same
// steps as every other adapter's scenario, in WebdriverIO's own idiom.
const env = (name) => {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set; run this through the conformance harness`
    )
  }
  return value
}

describe('conformance', () => {
  it('drives the fake pages', async () => {
    await browser.url(env('CONFORMANCE_LOGIN_URL'))
    await $('#username').setValue('tom')
    await $('#password').setValue('secret')
    await $('button[type="submit"]').click()
    await $('#logout').click()
    try {
      await browser.url(env('CONFORMANCE_BROKEN_URL'))
    } catch {
      // The failed navigation is part of the scenario.
    }
  })
})
