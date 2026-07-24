import { browser, expect } from '@wdio/globals'

// Deterministically flaky: throws on the first attempt and passes on the retry.
// The module-level counter survives mocha's in-process retry, so attempt 0 fails
// and attempt 1 succeeds. The test ends PASSED — so retain-on-failure would drop
// its trace, but on-first-retry keeps it, which is exactly what B4 verifies:
// the retry attempt is captured and is distinct from a failure.
let attempts = 0

describe('Flaky (passes on retry)', () => {
  it('fails the first attempt, then passes', async () => {
    await browser.url('https://the-internet.herokuapp.com/login')
    attempts += 1
    if (attempts === 1) {
      throw new Error('intentional first-attempt failure — should retry')
    }
    await expect(browser).toHaveTitle('The Internet')
  })
})
