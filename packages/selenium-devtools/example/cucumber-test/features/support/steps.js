import { strict as assert } from 'node:assert'
import { Given, When, Then } from '@cucumber/cucumber'
import { By, until } from 'selenium-webdriver'

Given('I am on the login page', async function () {
  await this.driver.get('https://the-internet.herokuapp.com/login')
})

When(
  'I enter username {string} and password {string}',
  async function (username, password) {
    await this.driver.findElement(By.id('username')).sendKeys(username)
    await this.driver.findElement(By.id('password')).sendKeys(password)
  }
)

When('I submit the login form', async function () {
  await this.driver.findElement(By.css('button[type="submit"]')).click()
})

Then('I should be on the secure page', async function () {
  await this.driver.wait(until.urlContains('/secure'), 10_000)
})

Then(
  'I should see a flash message matching {string}',
  async function (pattern) {
    const flash = await this.driver.wait(
      until.elementLocated(By.id('flash')),
      10_000
    )
    const text = await flash.getText()
    assert.match(text, new RegExp(pattern, 'i'))
    await this.driver.sleep(1500)
  }
)

Then('I should still be on the login page', async function () {
  const url = await this.driver.getCurrentUrl()
  assert.match(url, /\/login$/)
})
