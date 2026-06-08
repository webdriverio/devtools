/**
 * Login flow against the-internet.herokuapp.com under Jest.
 *
 * Run from the package root:  pnpm example:jest
 */

import { DevTools } from '@wdio/selenium-devtools'
import { Builder, By, until } from 'selenium-webdriver'

const LOGIN_URL = 'https://the-internet.herokuapp.com/login'
const VALID_USERNAME = 'tomsmith'
const VALID_PASSWORD = 'SuperSecretPassword!'

DevTools.configure({
  mode: 'trace',
  headless: true
})

describe('the-internet login flow', () => {
  let driver

  beforeEach(async () => {
    driver = await new Builder().forBrowser('chrome').build()
  }, 60000)

  afterEach(async () => {
    if (driver) {
      await driver.quit()
    }
  })

  test('logs in with valid credentials and lands on /secure', async () => {
    await driver.get(LOGIN_URL)
    await driver.findElement(By.id('username')).sendKeys(VALID_USERNAME)
    await driver.findElement(By.id('password')).sendKeys(VALID_PASSWORD)
    await driver.findElement(By.css('button[type="submit"]')).click()

    await driver.wait(until.urlContains('/secure'), 10000)
    const flash = await driver.wait(until.elementLocated(By.id('flash')), 10000)
    const flashText = await flash.getText()
    expect(flashText).toMatch(/You logged into a secure area/i)

    await driver.sleep(1500)
  }, 60000)

  test('rejects invalid username with an error flash', async () => {
    await driver.get(LOGIN_URL)
    await driver.findElement(By.id('username')).sendKeys('foobar')
    await driver.findElement(By.id('password')).sendKeys('barfoo')
    await driver.findElement(By.css('button[type="submit"]')).click()

    const flash = await driver.wait(until.elementLocated(By.id('flash')), 10000)
    const flashText = await flash.getText()
    expect(flashText).toMatch(/Your username is invalid/i)
    const url = await driver.getCurrentUrl()
    expect(url).toMatch(/\/login$/)

    await driver.sleep(1500)
  }, 60000)
})
