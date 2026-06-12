export type ActionCategory =
  | 'navigation'
  | 'input'
  | 'assertion'
  | 'query'
  | 'other'

const NAVIGATION = new Set([
  'url',
  'navigateTo',
  'back',
  'forward',
  'refresh',
  'reloadSession',
  'newWindow',
  'switchWindow',
  'closeWindow',
  'switchToFrame',
  'switchToParentFrame'
])

const INPUT = new Set([
  'click',
  'doubleClick',
  'setValue',
  'addValue',
  'clearValue',
  'selectByAttribute',
  'selectByIndex',
  'selectByVisibleText',
  'dragAndDrop',
  'scrollIntoView',
  'moveTo',
  'keys',
  'touchAction',
  'uploadFile',
  'setWindowSize'
])

const ASSERTION = new Set([
  'isExisting',
  'isDisplayed',
  'isDisplayedInViewport',
  'isVisible',
  'isEnabled',
  'isSelected',
  'isClickable',
  'isFocused',
  'waitForExist',
  'waitForDisplayed',
  'waitForEnabled',
  'waitForClickable',
  'waitForElementVisible',
  'waitForElementPresent',
  'waitForElementNotPresent',
  'waitUntil'
])

const QUERY = new Set([
  '$',
  '$$',
  'getText',
  'getAttribute',
  'getValue',
  'getProperty',
  'getCSSProperty',
  'getHTML',
  'getTagName',
  'getSize',
  'getLocation',
  'getTitle',
  'getUrl',
  'getPageSource',
  'custom$',
  'react$',
  'shadow$',
  'findElement',
  'findElements'
])

/** Group a command by intent so the timeline can colour it consistently. */
export function commandCategory(command: string): ActionCategory {
  if (NAVIGATION.has(command)) {
    return 'navigation'
  }
  if (INPUT.has(command)) {
    return 'input'
  }
  if (ASSERTION.has(command)) {
    return 'assertion'
  }
  if (QUERY.has(command)) {
    return 'query'
  }
  return 'other'
}

/**
 * The mockup uses a distinct glyph per command intent — finer than the colour
 * category (e.g. `$` and `getText` are both "query"-coloured but get a target
 * vs. text icon). This maps a command to that glyph; unknowns fall to 'execute'.
 */
export type ActionIcon =
  | 'navigate'
  | 'reload'
  | 'select'
  | 'type'
  | 'click'
  | 'assert'
  | 'read'
  | 'execute'

const RELOAD = new Set(['reloadSession', 'refresh'])
const SELECT = new Set([
  '$',
  '$$',
  'custom$',
  'react$',
  'shadow$',
  'findElement',
  'findElements'
])
const TYPE = new Set(['setValue', 'addValue', 'clearValue', 'keys'])

export function commandIcon(command: string): ActionIcon {
  if (RELOAD.has(command)) {
    return 'reload'
  }
  if (NAVIGATION.has(command)) {
    return 'navigate'
  }
  if (SELECT.has(command)) {
    return 'select'
  }
  if (TYPE.has(command)) {
    return 'type'
  }
  if (INPUT.has(command)) {
    return 'click'
  }
  if (ASSERTION.has(command)) {
    return 'assert'
  }
  if (QUERY.has(command)) {
    return 'read'
  }
  return 'execute'
}
