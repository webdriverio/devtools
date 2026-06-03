import { describe, it, expect } from 'vitest'
import {
  isWebElementLike,
  safeSerialize,
  webElementSummary,
  getDriverOriginals,
  getElementOriginals
} from '../src/driverPatcher.js'

describe('isWebElementLike', () => {
  it('detects an object with getId + click as a WebElement', () => {
    const el = { getId: () => 'a', click: () => {} }
    expect(isWebElementLike(el)).toBe(true)
  })

  it('rejects plain objects without click/getId', () => {
    expect(isWebElementLike({ foo: 'bar' })).toBe(false)
    expect(isWebElementLike({ getId: () => 'a' })).toBe(false)
    expect(isWebElementLike({ click: () => {} })).toBe(false)
  })

  it('rejects primitives and null/undefined', () => {
    // The function uses && chaining so it returns the raw falsy value for
    // null/undefined inputs — assert falsy rather than strict false.
    expect(isWebElementLike(null)).toBeFalsy()
    expect(isWebElementLike(undefined)).toBeFalsy()
    expect(isWebElementLike(42)).toBeFalsy()
    expect(isWebElementLike('not-an-element')).toBeFalsy()
    expect(isWebElementLike(true)).toBeFalsy()
  })
})

describe('webElementSummary', () => {
  it('uses the resolved id_ value when present', () => {
    expect(webElementSummary({ id_: { _value: 'elem-1' } })).toBe(
      '<WebElement id=elem-1>'
    )
    expect(webElementSummary({ id_: { value: 'elem-2' } })).toBe(
      '<WebElement id=elem-2>'
    )
  })

  it('falls back to a bare summary when id is not resolved', () => {
    expect(webElementSummary({})).toBe('<WebElement>')
    expect(webElementSummary({ id_: undefined })).toBe('<WebElement>')
    expect(webElementSummary(null)).toBe('<WebElement>')
  })
})

describe('safeSerialize', () => {
  it('passes primitives through unchanged', () => {
    expect(safeSerialize(42)).toBe(42)
    expect(safeSerialize('hi')).toBe('hi')
    expect(safeSerialize(true)).toBe(true)
  })

  it('preserves null and undefined', () => {
    expect(safeSerialize(null)).toBe(null)
    expect(safeSerialize(undefined)).toBe(undefined)
  })

  it('summarizes functions as [Function]', () => {
    expect(safeSerialize(() => 1)).toBe('[Function]')
    expect(safeSerialize(function named() {})).toBe('[Function]')
  })

  it('summarizes single WebElement-like values', () => {
    const el = { getId: () => 'a', click: () => {}, id_: { _value: 'x' } }
    expect(safeSerialize(el)).toBe('<WebElement id=x>')
  })

  it('summarizes a homogeneous WebElement[] as <WebElement[]> (count: N)', () => {
    const el = { getId: () => 'a', click: () => {} }
    expect(safeSerialize([el, el, el])).toBe('<WebElement[]> (count: 3)')
  })

  it('formats a Selenium "By" locator as "By.<using>(<value>)"', () => {
    expect(safeSerialize({ using: 'css selector', value: '.btn' })).toBe(
      'By.css selector(".btn")'
    )
    expect(safeSerialize({ using: 'id', value: 'main' })).toBe('By.id("main")')
  })

  it('recursively serializes plain arrays', () => {
    expect(safeSerialize([1, 'a', null, undefined])).toEqual([
      1,
      'a',
      null,
      undefined
    ])
  })

  it('mixed array with one non-element falls back to per-item serialize', () => {
    const el = { getId: () => 'a', click: () => {} }
    expect(safeSerialize([el, 'plain'])).toEqual(['<WebElement>', 'plain'])
  })

  it('JSON-roundtrips plain objects', () => {
    expect(safeSerialize({ a: 1, b: 'two', c: [true] })).toEqual({
      a: 1,
      b: 'two',
      c: [true]
    })
  })

  it('falls back to String() for objects that cannot serialize (cyclic)', () => {
    const cyclic: any = { name: 'me' }
    cyclic.self = cyclic
    const out = safeSerialize(cyclic)
    expect(typeof out).toBe('string')
    expect(out).toContain('[object')
  })
})

describe('getDriverOriginals / getElementOriginals', () => {
  it('return objects (the in-memory pristine-prototype stash)', () => {
    const d = getDriverOriginals()
    const e = getElementOriginals()
    expect(typeof d).toBe('object')
    expect(typeof e).toBe('object')
    expect(d).not.toBeNull()
    expect(e).not.toBeNull()
  })
})
