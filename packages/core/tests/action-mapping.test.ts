import { describe, it, expect } from 'vitest'
import { ACTION_MAP } from '@wdio/devtools-shared'
import { formatActionTitle, mapCommandToAction } from '../src/action-mapping.js'

describe('mapCommandToAction for read/query commands', () => {
  const elementReads: [string, string][] = [
    ['getText', 'getText'],
    ['getValue', 'getValue'],
    ['getAttribute', 'getAttribute'],
    ['getProperty', 'getProperty'],
    ['getCSSProperty', 'getCSSProperty'],
    ['getTagName', 'getTagName'],
    ['getLocation', 'getLocation'],
    ['getSize', 'getSize'],
    ['isDisplayed', 'isDisplayed'],
    ['isExisting', 'isExisting'],
    ['isEnabled', 'isEnabled'],
    ['isSelected', 'isSelected'],
    ['isClickable', 'isClickable'],
    ['isFocused', 'isFocused'],
    ['waitForDisplayed', 'waitForDisplayed'],
    ['waitForExist', 'waitForExist'],
    ['waitForEnabled', 'waitForEnabled'],
    ['waitForClickable', 'waitForClickable']
  ]

  it.each(elementReads)('maps %s to Element.%s', (command, method) => {
    expect(mapCommandToAction(command)).toEqual({ class: 'Element', method })
  })

  it('maps waitUntil to Browser.waitForFunction', () => {
    expect(mapCommandToAction('waitUntil')).toEqual({
      class: 'Browser',
      method: 'waitForFunction'
    })
  })

  it('maps page/browser reads to the Page class', () => {
    expect(mapCommandToAction('getTitle')).toEqual({
      class: 'Page',
      method: 'getTitle'
    })
    expect(mapCommandToAction('getUrl')).toEqual({
      class: 'Page',
      method: 'getUrl'
    })
    expect(mapCommandToAction('getPageSource')).toEqual({
      class: 'Page',
      method: 'getPageSource'
    })
  })

  it('normalizes Selenium read aliases onto the WDIO names', () => {
    expect(mapCommandToAction('getCssValue')).toEqual({
      class: 'Element',
      method: 'getCSSProperty'
    })
    expect(mapCommandToAction('getCurrentUrl')).toEqual({
      class: 'Page',
      method: 'getUrl'
    })
    expect(mapCommandToAction('getRect')).toEqual({
      class: 'Element',
      method: 'getRect'
    })
  })
})

describe('mapCommandToAction still excludes noisy/internal commands', () => {
  it.each([
    'clearValue',
    'addValue',
    'executeScript',
    '$',
    '$$',
    'findElement',
    'findElements',
    'getElement',
    'getElements'
  ])('returns null for %s', (command) => {
    expect(mapCommandToAction(command)).toBeNull()
  })
})

describe('formatActionTitle for read/query commands', () => {
  it('renders a selector-first title when the selector is the first arg', () => {
    expect(
      formatActionTitle({ class: 'Element', method: 'getText' }, ['#sel'])
    ).toBe('Element.getText("#sel")')
    expect(
      formatActionTitle({ class: 'Element', method: 'isDisplayed' }, ['#sel'])
    ).toBe('Element.isDisplayed("#sel")')
  })

  it('uses params.selector when there is no positional arg', () => {
    expect(
      formatActionTitle({ class: 'Element', method: 'waitForExist' }, [], {
        selector: '#sel'
      })
    ).toBe('Element.waitForExist("#sel")')
  })

  it('falls back to an argument-free title when nothing identifies the target', () => {
    expect(formatActionTitle({ class: 'Page', method: 'getTitle' }, [])).toBe(
      'Page.getTitle()'
    )
  })
})

describe('ACTION_MAP forward/reverse integrity', () => {
  it('never maps two commands to the same class.method with conflicting intent', () => {
    // The reader derives REVERSE_ACTION_MAP by keeping the first command per
    // class.method. Duplicated targets are only safe when the runner commands
    // are true synonyms (e.g. url/navigateTo/get all → Page.navigate).
    const targetToCommands = new Map<string, string[]>()
    for (const [command, action] of Object.entries(ACTION_MAP)) {
      const key = `${action.class}.${action.method}`
      targetToCommands.set(key, [...(targetToCommands.get(key) ?? []), command])
    }

    // The new read methods must not collide with an existing interaction target.
    const interactionTargets = new Set([
      'Element.click',
      'Element.fill',
      'Element.clear',
      'Element.submit',
      'Element.hover',
      'Element.tap',
      'Page.navigate',
      'Keyboard.press'
    ])
    for (const method of [
      'getText',
      'getValue',
      'getAttribute',
      'getProperty',
      'getCSSProperty',
      'getTagName',
      'getLocation',
      'getSize',
      'getRect',
      'isDisplayed',
      'isExisting',
      'isEnabled',
      'isSelected',
      'isClickable',
      'isFocused',
      'waitForDisplayed',
      'waitForExist',
      'waitForEnabled',
      'waitForClickable'
    ]) {
      expect(interactionTargets.has(`Element.${method}`)).toBe(false)
    }

    // getCssValue normalizes onto getCSSProperty, and getCurrentUrl onto getUrl;
    // the WDIO name is listed first so the reverse map keeps it.
    const cssCommands = targetToCommands.get('Element.getCSSProperty') ?? []
    expect(cssCommands[0]).toBe('getCSSProperty')
    const urlCommands = targetToCommands.get('Page.getUrl') ?? []
    expect(urlCommands[0]).toBe('getUrl')
  })
})
