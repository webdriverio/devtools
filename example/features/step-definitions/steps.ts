import { Given, When, Then, After } from '@wdio/cucumber-framework'
import { browser, expect } from '@wdio/globals'

import LoginPage from '../pageobjects/login.page.js'
import SecurePage from '../pageobjects/secure.page.js'

const pages = {
  login: LoginPage
} as const

After(async () => {
  await browser.reloadSession()
})

Given(/^I am on the (\w+) page$/, async (page: keyof typeof pages) => {
  console.log(`[TEST] Navigating to ${page} page`)
  await pages[page].open()
  console.log(`[TEST] Successfully opened ${page} page`)
})

When(/^I login with (\w+) and (.+)$/, async (username, password) => {
  console.log(`[TEST] Attempting login with username: ${username}`)
  await LoginPage.login(username, password)
  console.info(`[TEST] Login submitted for user: ${username}`)
})

Then(/^I should see a flash message saying (.*)$/, async (message) => {
  console.log(`[TEST] Verifying flash message: ${message}`)
  const el = await SecurePage.flashAlert
  await expect(el).toBeExisting()
  await expect(el).toHaveText(expect.stringContaining(message))
  console.log('[TEST] Flash message verified successfully')
  // await browser.pause(15000)
})
