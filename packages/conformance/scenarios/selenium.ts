// Imported first: the import is what patches selenium-webdriver.
import { DevTools } from '@wdio/selenium-devtools'
import { Builder, By } from 'selenium-webdriver'

import { SCENARIO_ENV } from '../src/constants.js'

DevTools.configure({ openUi: false })

const env = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set; run this through the conformance harness`
    )
  }
  return value
}

const driver = await new Builder()
  .forBrowser('chrome')
  .usingServer(env(SCENARIO_ENV.webdriver))
  .build()
try {
  await driver.get(env(SCENARIO_ENV.login))
  await driver.findElement(By.css('#username')).sendKeys('tom')
  await driver.findElement(By.css('#password')).sendKeys('secret')
  await driver.findElement(By.css('button[type="submit"]')).click()
  await driver.findElement(By.css('#logout')).click()
  await driver.get(env(SCENARIO_ENV.broken)).catch(() => undefined)
} finally {
  await driver.quit()
}
