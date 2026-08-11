// Step definitions for the example-site smoke scenario.
//
// Nightwatch's Cucumber integration injects the Nightwatch `browser` onto the
// World, so steps reach it via `this.browser` — hence regular (non-arrow)
// functions so `this` binds to the World.
const { Given, When, Then } = require('@cucumber/cucumber')

Given(/^I navigate to "([^"]*)"$/, async function (url) {
  await this.browser.url(url)
})

When(/^the page body becomes visible$/, async function () {
  await this.browser.waitForElementVisible('body', 5000)
})

Then(/^the page title contains "([^"]*)"$/, async function (title) {
  await this.browser.assert.titleContains(title)
})
