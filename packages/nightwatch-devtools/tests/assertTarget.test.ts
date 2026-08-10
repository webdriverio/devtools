import { describe, it, expect } from 'vitest'
import {
  assertTargetSelector,
  commandRowSelector,
  commandTargetSelector
} from '../src/helpers/assertTarget.js'

describe('assertTargetSelector', () => {
  it('reads the element definition of an element assertion', () => {
    expect(assertTargetSelector('textContains', ['#flash', 'You logged'])).toBe(
      '#flash'
    )
    expect(assertTargetSelector('visible', ['a.button'])).toBe('a.button')
    expect(assertTargetSelector('elementsCount', ['li', 3])).toBe('li')
    expect(
      assertTargetSelector('attributeEquals', ['#link', 'href', '/secure'])
    ).toBe('#link')
  })

  it('names no element for the page-level and value assertions', () => {
    // The bug this prevents: `/secure` and `The Internet` are the expected
    // VALUE, and attaching one boxes whatever element happens to match it.
    expect(assertTargetSelector('urlContains', ['/secure'])).toBeUndefined()
    expect(
      assertTargetSelector('titleContains', ['The Internet'])
    ).toBeUndefined()
    expect(assertTargetSelector('titleMatches', [/Internet/])).toBeUndefined()
    expect(assertTargetSelector('urlEquals', ['#flash'])).toBeUndefined()
    // node:assert's mirrors live on the same namespace and take values too.
    expect(assertTargetSelector('ok', [true])).toBeUndefined()
    expect(assertTargetSelector('strictEqual', ['a', 'a'])).toBeUndefined()
  })

  it('reads through the negated namespace', () => {
    expect(assertTargetSelector('not.visible', ['#flash'])).toBe('#flash')
    expect(assertTargetSelector('not.urlContains', ['/secure'])).toBeUndefined()
  })

  it('unwraps a definition object and a Nightwatch Element', () => {
    expect(
      assertTargetSelector('visible', [
        { selector: '//div[@id="x"]', locateStrategy: 'xpath' }
      ])
    ).toBe('//div[@id="x"]')
    // Duck-typed: an Element instance exposes the same `selector` getter.
    class FakeElement {
      constructor(public selector: string) {}
    }
    expect(assertTargetSelector('textEquals', [new FakeElement('#el')])).toBe(
      '#el'
    )
  })

  it('names nothing when the definition carries no selector', () => {
    // A resolved WebElement handle — no locator to recover, so no box rather
    // than a wrong one.
    expect(
      assertTargetSelector('visible', [{ id_: 'abc', driver_: {} }])
    ).toBeUndefined()
    expect(assertTargetSelector('visible', [''])).toBeUndefined()
    expect(assertTargetSelector('visible', [])).toBeUndefined()
    expect(assertTargetSelector('elementPresent', [null])).toBeUndefined()
  })

  it('names nothing for an unknown assertion', () => {
    // A custom or newer assertion isn't in the table, so it degrades to no
    // locator instead of guessing that arg 0 is an element.
    expect(assertTargetSelector('myCustomAssert', ['#x'])).toBeUndefined()
  })
})

describe('commandTargetSelector', () => {
  it('reads the element a read command took its value from', () => {
    expect(commandTargetSelector('getText', ['#flash'])).toBe('#flash')
    expect(commandTargetSelector('getValue', ['#username'])).toBe('#username')
    expect(commandTargetSelector('getAttribute', ['#link', 'href'])).toBe(
      '#link'
    )
    expect(commandTargetSelector('isVisible', ['a.button'])).toBe('a.button')
    expect(
      commandTargetSelector('waitForElementVisible', ['#flash', 5000])
    ).toBe('#flash')
  })

  it('names no element for a page-level read — the null sentinel', () => {
    // These record their value as belonging to NO element, which is what stops a
    // `assert.strictEqual(await browser.title(), …)` inheriting the box of an
    // element that happens to read the same text.
    expect(commandTargetSelector('title', [])).toBeUndefined()
    expect(commandTargetSelector('getTitle', [])).toBeUndefined()
    expect(commandTargetSelector('getCurrentUrl', [])).toBeUndefined()
    expect(commandTargetSelector('source', [])).toBeUndefined()
    expect(
      commandTargetSelector('execute', ['return document.title'])
    ).toBeUndefined()
  })

  it('does not read a navigation url as a locator', () => {
    // `browser.url('https://…')` takes a string first, like an element command.
    expect(
      commandTargetSelector('url', ['https://example.com/login'])
    ).toBeUndefined()
  })

  it('unwraps an element definition object', () => {
    expect(
      commandTargetSelector('getText', [
        { selector: '//h1', locateStrategy: 'xpath' }
      ])
    ).toBe('//h1')
  })

  it('names nothing when the definition carries no selector', () => {
    expect(commandTargetSelector('getText', [])).toBeUndefined()
    expect(commandTargetSelector('getText', [{ id_: 'abc' }])).toBeUndefined()
  })
})

describe('commandRowSelector', () => {
  it('names the element a command acted on as well as one it read', () => {
    // Wider than commandTargetSelector: a click acts on an element but produces
    // no value, so it stays out of the provenance registry while still being a
    // row about that element.
    expect(commandRowSelector('click', ['button[type="submit"]'])).toBe(
      'button[type="submit"]'
    )
    expect(commandRowSelector('setValue', ['#username', 'tomsmith'])).toBe(
      '#username'
    )
    expect(commandRowSelector('waitForElementVisible', ['#flash', 5000])).toBe(
      '#flash'
    )
    expect(commandTargetSelector('click', ['button'])).toBeUndefined()
  })

  it('names no element for a page-level command', () => {
    // The regression this guards: `url` and `keys` take a string first too, and
    // stamping it as the row's locator boxes whatever happens to match it.
    expect(
      commandRowSelector('url', ['https://example.com/login'])
    ).toBeUndefined()
    expect(commandRowSelector('keys', ['abc'])).toBeUndefined()
    expect(commandRowSelector('pause', [500])).toBeUndefined()
  })

  it('unwraps an element definition object', () => {
    expect(
      commandRowSelector('click', [
        { selector: '//a[@id="x"]', locateStrategy: 'xpath' }
      ])
    ).toBe('//a[@id="x"]')
  })
})
