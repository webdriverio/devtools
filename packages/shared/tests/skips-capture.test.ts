import { describe, it, expect } from 'vitest'
import { ACTION_MAP, METHOD_EFFECT, skipsCapture } from '@wdio/devtools-shared'

describe('skipsCapture', () => {
  it.each([
    'getText',
    'isDisplayed',
    'waitForDisplayed',
    'waitForElementVisible',
    'waitUntil',
    'getTitle',
    'findElement',
    'getAllWindowHandles',
    'printPage',
    'getCredentials',
    'getDownloadableFiles',
    'getCurrentUrl',
    'assert.equal',
    'expect.toHaveText',
    'getElementText',
    'w3cGetCurrentWindowHandle',
    'getElementAriaRole',
    'isVisible',
    'title',
    'getDomAttribute'
  ])('is true for %s', (command) => {
    expect(skipsCapture(command)).toBe(true)
  })

  it.each([
    'click',
    'setValue',
    'url',
    'execute',
    'keys',
    'sendKeys',
    'switchToWindow',
    'executeScript',
    'actions',
    'submitForm',
    'acceptAlert',
    'w3cExecuteScript',
    'someUnknownCommand',
    'constructor'
  ])('is false for %s', (command) => {
    expect(skipsCapture(command)).toBe(false)
  })

  it('classifies the method of every ACTION_MAP entry', () => {
    for (const { method } of Object.values(ACTION_MAP)) {
      expect(Object.keys(METHOD_EFFECT)).toContain(method)
    }
  })
})
