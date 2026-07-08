import { expect } from '@wdio/globals'

import LoginPage from '../../pageobjects/login.page.js'
import SecurePage from '../../pageobjects/secure.page.js'

// Deliberately failing — mirrors login-fail.feature, so the Errors tab and
// tracePolicy: 'retain-on-failure' have something to exercise.
describe('Login (failing)', () => {
  it('asserts the wrong flash message so the run fails', async () => {
    console.log('[TEST] submitting invalid credentials')
    await LoginPage.open()
    await LoginPage.login('foobar', 'barfoo')
    await expect(SecurePage.flashAlert).toHaveText(
      expect.stringContaining('You logged into a secure area!')
    )
  })
})
