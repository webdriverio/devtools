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
    await pages[page].open()
})

When(/^I login with (\w+) and (.+)$/, async (username, password) => {
    await LoginPage.login(username, password)
})

Then(/^I should see a flash message saying (.*)$/, async (message) => {
    const el = await SecurePage.flashAlert
    await expect(el).toBeExisting()
    await expect(el).toHaveText(expect.stringContaining(message))
    await browser.pause(15000)
})

