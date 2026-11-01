import { describe, it, expect } from 'vitest'
import { locatorsToObject } from '@wdio/elements/locators'

describe('locatorsToObject', () => {
  it('converts locator array to object', () => {
    const locators: [any, string][] = [
      ['accessibility-id', '~Submit'],
      ['xpath', '//XCUIElementTypeButton[@name="Submit"]']
    ]
    const result = locatorsToObject(locators)
    expect(result['accessibility-id']).toBe('~Submit')
    expect(result['xpath']).toBe('//XCUIElementTypeButton[@name="Submit"]')
  })

  it('returns first value for duplicate strategies', () => {
    const locators: [any, string][] = [
      ['xpath', '//first'],
      ['xpath', '//second']
    ]
    const result = locatorsToObject(locators)
    expect(result['xpath']).toBe('//first')
  })
})
