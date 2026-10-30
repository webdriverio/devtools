import { describe, it, expect } from 'vitest'

import { isUiAutomatorDriver } from '../src/locators/element-filter.js'
import { getSuggestedLocators } from '../src/locators/locator-generation.js'
import type { JSONElement } from '../src/locators/types.js'

describe('isUiAutomatorDriver', () => {
  it('reads every UiAutomator driver as Android, whatever its case', () => {
    expect(isUiAutomatorDriver('UiAutomator2')).toBe(true)
    expect(isUiAutomatorDriver('uiautomator')).toBe(true)
    expect(isUiAutomatorDriver('Espresso-UiAutomator2')).toBe(true)
  })

  it('reads any other driver as iOS', () => {
    expect(isUiAutomatorDriver('XCUITest')).toBe(false)
    expect(isUiAutomatorDriver('Espresso')).toBe(false)
    expect(isUiAutomatorDriver('')).toBe(false)
  })
})

describe('getSuggestedLocators platform branch', () => {
  const element: JSONElement = {
    tagName: 'XCUIElementTypeButton',
    attributes: { name: 'Submit', 'resource-id': 'app:id/submit' },
    children: [],
    path: '0'
  }

  it('builds Android strategies for a UiAutomator driver', () => {
    const xml =
      '<hierarchy><android.widget.Button resource-id="app:id/submit"/></hierarchy>'
    const strategies = getSuggestedLocators(
      { ...element, tagName: 'android.widget.Button' },
      xml,
      'UiAutomator2'
    ).map(([strategy]) => strategy)

    expect(strategies).toEqual(['id', 'xpath'])
  })

  it('builds iOS strategies for any other driver', () => {
    const xml = '<AppiumAUT><XCUIElementTypeButton name="Submit"/></AppiumAUT>'
    const strategies = getSuggestedLocators(element, xml, 'XCUITest').map(
      ([strategy]) => strategy
    )

    expect(strategies).toContain('accessibility-id')
    expect(strategies).not.toContain('uiautomator')
  })
})
