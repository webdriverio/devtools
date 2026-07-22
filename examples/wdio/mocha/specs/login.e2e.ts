import { expect } from '@wdio/globals'

import LoginPage from '../../pageobjects/login.page.js'
import SecurePage from '../../pageobjects/secure.page.js'

describe('Login', () => {
  it('logs into the secure area with valid credentials', async () => {
    console.log('[TEST] logging in with valid credentials')
    await LoginPage.open()
    await LoginPage.login('tomsmith', 'SuperSecretPassword!')
    await expect(SecurePage.flashAlert).toBeExisting()
    await expect(SecurePage.flashAlert).toHaveText(
      expect.stringContaining('You logged into a secure area!')
    )
    console.log('[TEST] secure area reached')
  })

  it('shows an error message for an invalid username', async () => {
    console.log('[TEST] logging in with an invalid username')
    await LoginPage.open()
    await LoginPage.login('foobar', 'barfoo')
    await expect(SecurePage.flashAlert).toHaveText(
      expect.stringContaining('Your username is invalid!')
    )
  })
})
