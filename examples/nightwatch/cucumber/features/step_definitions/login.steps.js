// Step definitions for the the-internet login scenarios.
//
// Nightwatch's Cucumber integration injects the Nightwatch `browser` onto the
// World, so steps reach it via `this.browser` — hence regular (non-arrow)
// functions so `this` binds to the World.
const { Given, When, Then } = require('@cucumber/cucumber')

const LOGIN_URL = 'https://the-internet.herokuapp.com/login'

Given(/^I am on the login page$/, async function () {
  await this.browser.url(LOGIN_URL)
  await this.browser.waitForElementVisible('#username', 5000)
})

When(
  /^I enter username "([^"]*)" and password "([^"]*)"$/,
  async function (username, password) {
    await this.browser.setValue('#username', username)
    await this.browser.setValue('#password', password)
  }
)

When(/^I submit the login form$/, async function () {
  await this.browser.click('button[type="submit"]')
})

Then(/^I should be on the secure page$/, async function () {
  await this.browser.waitForElementVisible('#flash', 5000)
  await this.browser.assert.urlContains('/secure')
})

Then(
  /^I should see a flash message matching "([^"]*)"$/,
  async function (text) {
    await this.browser.waitForElementVisible('#flash', 5000)
    await this.browser.assert.textContains('#flash', text)
  }
)

Then(/^I should still be on the login page$/, async function () {
  await this.browser.assert.urlContains('/login')
})
