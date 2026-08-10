import { describe, it, expect } from 'vitest'
import {
  rememberReadValue,
  resolveAssertTargetFromArgs,
  selectorForReadValue
} from '../src/read-value-locators.js'

describe('read-value provenance', () => {
  it('names the element a read value came from', () => {
    rememberReadValue('You logged into a secure area!', '#flash')
    expect(selectorForReadValue('You logged into a secure area!')).toBe(
      '#flash'
    )
  })

  it('lets a driver-level read clear an element claim on the same value', () => {
    // Regression: `h1` and the document title are both "Example Domain" in the
    // selenium mocha example, so a page-title assertion inherited the h1's
    // locator and the overlay boxed an element the assertion was not about. The
    // nightwatch equivalent is `browser.title()` / `browser.getCurrentUrl()`.
    rememberReadValue('Example Domain', 'h1')
    rememberReadValue('Example Domain', undefined)
    expect(selectorForReadValue('Example Domain')).toBeUndefined()
  })

  it('lets the most recent producer win', () => {
    rememberReadValue('Submit', '#first')
    rememberReadValue('Submit', '#second')
    expect(selectorForReadValue('Submit')).toBe('#second')
  })

  it('lets an element read reclaim a value a page-level read released', () => {
    rememberReadValue('The Internet', undefined)
    rememberReadValue('The Internet', 'h1')
    expect(selectorForReadValue('The Internet')).toBe('h1')
  })

  it('keeps values of different primitive types apart', () => {
    rememberReadValue(1, '#number')
    rememberReadValue('1', '#string')
    rememberReadValue(true, '#boolean')
    expect(selectorForReadValue(1)).toBe('#number')
    expect(selectorForReadValue('1')).toBe('#string')
    expect(selectorForReadValue(true)).toBe('#boolean')
  })

  it('ignores values that cannot identify an assertion subject', () => {
    // An empty string is what every element with no text reads as; an object is
    // matched by identity, which no assertion on a read value relies on.
    rememberReadValue('', '#empty')
    rememberReadValue(undefined, '#undefined')
    rememberReadValue(null, '#null')
    const obj = { x: 1 }
    rememberReadValue(obj, '#object')
    expect(selectorForReadValue('')).toBeUndefined()
    expect(selectorForReadValue(undefined)).toBeUndefined()
    expect(selectorForReadValue(null)).toBeUndefined()
    expect(selectorForReadValue(obj)).toBeUndefined()
  })

  it('ignores a value too long to be an assertion subject', () => {
    // getPageSource and takeScreenshot are captured commands too — keying the
    // registry on their results would pin megabytes for the run.
    const huge = 'x'.repeat(300)
    rememberReadValue(huge, '#huge')
    expect(selectorForReadValue(huge)).toBeUndefined()
  })

  it('evicts the least recent value once the registry is full', () => {
    rememberReadValue('oldest-value', '#oldest')
    for (let i = 0; i < 200; i++) {
      rememberReadValue(`filler-${i}`, `#filler-${i}`)
    }
    expect(selectorForReadValue('oldest-value')).toBeUndefined()
    expect(selectorForReadValue('filler-199')).toBe('#filler-199')
  })

  it('keeps a re-read value alive across an eviction sweep', () => {
    // Recency is by last WRITE, so a value the test keeps reading stays in the
    // registry however long the run is.
    rememberReadValue('kept-value', '#kept')
    for (let i = 0; i < 150; i++) {
      rememberReadValue(`sweep-a-${i}`, `#sweep-a-${i}`)
    }
    rememberReadValue('kept-value', '#kept')
    for (let i = 0; i < 150; i++) {
      rememberReadValue(`sweep-b-${i}`, `#sweep-b-${i}`)
    }
    expect(selectorForReadValue('kept-value')).toBe('#kept')
  })
})

describe('resolveAssertTargetFromArgs', () => {
  it('names the element a read value came from', () => {
    rememberReadValue('You logged into a secure area!', '#flash')
    expect(
      resolveAssertTargetFromArgs([
        'You logged into a secure area!',
        'You logged into a secure area'
      ])
    ).toBe('#flash')
  })

  it('takes the first arg that resolves — node:assert puts the subject first', () => {
    rememberReadValue('actual-text', '#subject')
    rememberReadValue('expected-text', '#other')
    expect(resolveAssertTargetFromArgs(['actual-text', 'expected-text'])).toBe(
      '#subject'
    )
  })

  it('names nothing for a page-level read or a literal', () => {
    rememberReadValue('The Internet', undefined)
    expect(resolveAssertTargetFromArgs(['The Internet'])).toBeUndefined()
    expect(resolveAssertTargetFromArgs([2, 2])).toBeUndefined()
    expect(resolveAssertTargetFromArgs([])).toBeUndefined()
  })

  it('prefers the adapter handle resolver over the value registry', () => {
    // Selenium's case: an element handle passed straight to the assert names its
    // own locator, and that beats whatever a read of the same object said.
    const handle = { id_: 'el-1' }
    rememberReadValue('ignored', '#value')
    expect(
      resolveAssertTargetFromArgs([handle, 'ignored'], (arg) =>
        arg === handle ? '#handle' : undefined
      )
    ).toBe('#handle')
  })
})
