import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { rememberReadValue } from '@wdio/devtools-core'
import {
  locatorToSelector,
  rememberElementLocator,
  selectorForElement
} from '../src/helpers/element-locators.js'
import { resolveAssertTarget } from '../src/assertPatcher.js'

const require = createRequire(import.meta.url)
const sw = require('selenium-webdriver')
const { By, WebElement, WebElementPromise } = sw

// Element commands act on a resolved handle, so these use the real selenium
// classes: the mechanism turns on one find producing TWO objects for one element
// (the promise it returns, the element that promise resolves to), neither of
// which exposes its element id synchronously.
function webElement(id: string): object {
  return new WebElement({}, id)
}
function webElementPromise(el: object): object {
  return new WebElementPromise({}, Promise.resolve(el))
}

describe('locatorToSelector', () => {
  it('canonicalizes By.id to the #id form the captured elements use', () => {
    // By.id compiles to `*[id="x"]`, which is equivalent but never string-matches
    // the `#x` in the captured element records the input point resolves against.
    expect(locatorToSelector(By.id('username'))).toBe('#username')
  })

  it('passes css, xpath and tag-name locators through', () => {
    expect(locatorToSelector(By.css('button[type="submit"]'))).toBe(
      'button[type="submit"]'
    )
    expect(locatorToSelector(By.xpath('//a[@href="/logout"]'))).toBe(
      '//a[@href="/logout"]'
    )
    expect(locatorToSelector(By.tagName('h1'))).toBe('h1')
  })

  it('reads By.className / By.name through their compiled css', () => {
    expect(locatorToSelector(By.className('radius'))).toBe('.radius')
    expect(locatorToSelector(By.name('q'))).toBe('*[name="q"]')
  })

  it('accepts a bare {using, value} pair and a raw selector string', () => {
    expect(locatorToSelector({ using: 'css selector', value: '#flash' })).toBe(
      '#flash'
    )
    expect(locatorToSelector('#flash')).toBe('#flash')
  })

  it('resolves shorthand hash locators the way By does', () => {
    expect(locatorToSelector({ id: 'username' })).toBe('#username')
    expect(locatorToSelector({ css: '.btn' })).toBe('.btn')
    expect(locatorToSelector({ className: 'a b' })).toBe('.a.b')
    expect(locatorToSelector({ name: 'q' })).toBe('[name="q"]')
    expect(locatorToSelector({ xpath: '//div' })).toBe('//div')
  })

  it('returns undefined for locators with no selector equivalent', () => {
    expect(locatorToSelector(By.linkText('Logout'))).toBeUndefined()
    expect(locatorToSelector(By.partialLinkText('Log'))).toBeUndefined()
    expect(locatorToSelector(() => [])).toBeUndefined()
    expect(locatorToSelector(undefined)).toBeUndefined()
    expect(locatorToSelector('')).toBeUndefined()
  })
})

describe('handle → locator correlation', () => {
  it('resolves a chained call from the promise findElement returned', () => {
    // `findElement(By.id('username')).sendKeys(…)` acts on the WebElementPromise
    // itself, before the element behind it exists.
    const handle = webElementPromise(webElement('el-1'))
    rememberElementLocator(handle, By.id('username'))
    expect(selectorForElement(handle)).toBe('#username')
  })

  it('resolves an awaited handle, which is a different object', () => {
    const resolved = webElement('el-1')
    const handle = webElementPromise(resolved)
    rememberElementLocator(handle, By.id('username'))
    rememberElementLocator(resolved, By.id('username'))
    expect(selectorForElement(resolved)).toBe('#username')
  })

  it('keeps each handle on its own locator across interleaved finds', () => {
    // The regression a "last selector wins" scheme causes: Selenium hands out
    // handles that outlive the find that made them, so the row for the FIRST
    // handle must not inherit the locator of the most recent find.
    const user = webElement('el-user')
    const pass = webElement('el-pass')
    rememberElementLocator(user, By.id('username'))
    rememberElementLocator(pass, By.id('password'))
    expect(selectorForElement(user)).toBe('#username')
    expect(selectorForElement(pass)).toBe('#password')
  })

  it('resolves every element of a findElements result', () => {
    const els = [webElement('el-1'), webElement('el-2')]
    rememberElementLocator(els, By.css('a[href]'))
    expect(els.map(selectorForElement)).toEqual(['a[href]', 'a[href]'])
  })

  it('keeps resolving a handle reused across repeated commands', () => {
    const el = webElement('el-1')
    rememberElementLocator(el, By.css('h1'))
    expect(selectorForElement(el)).toBe('h1')
    expect(selectorForElement(el)).toBe('h1')
  })

  it('returns undefined for an unseen handle and a non-object', () => {
    expect(selectorForElement(webElement('never-found'))).toBeUndefined()
    expect(selectorForElement(undefined)).toBeUndefined()
  })

  it('remembers nothing for a locator with no selector equivalent', () => {
    const el = webElement('el-1')
    rememberElementLocator(el, By.linkText('Logout'))
    expect(selectorForElement(el)).toBeUndefined()
  })
})

// The value→locator registry itself is core's — see
// packages/core/tests/read-value-locators.test.ts. These cover only the
// selenium-side composition of the two provenance sources.
describe('resolveAssertTarget', () => {
  it('names the element a read value came from', () => {
    rememberReadValue('Example Domain', 'h1')
    expect(resolveAssertTarget(['Example Domain', 'Example Domain'])).toBe('h1')
  })

  it('names an element handle passed straight to the assert', () => {
    const el = webElement('el-1')
    rememberElementLocator(el, By.id('flash'))
    expect(resolveAssertTarget([el])).toBe('#flash')
  })

  it('takes the first arg that resolves — node:assert puts the subject first', () => {
    rememberReadValue('actual-text', '#subject')
    rememberReadValue('expected-text', '#other')
    expect(resolveAssertTarget(['actual-text', 'expected-text'])).toBe(
      '#subject'
    )
  })

  it('names nothing when no arg traces back to an element', () => {
    expect(resolveAssertTarget(['never-read', /a-regexp/])).toBeUndefined()
    expect(resolveAssertTarget([])).toBeUndefined()
  })
})
