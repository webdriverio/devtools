import { describe, it, expect } from 'vitest'

import {
  commandCategory,
  commandIcon
} from '../src/components/workbench/actionItems/category.js'

describe('commandCategory', () => {
  it('classifies navigation commands', () => {
    expect(commandCategory('url')).toBe('navigation')
    expect(commandCategory('reloadSession')).toBe('navigation')
    expect(commandCategory('back')).toBe('navigation')
  })

  it('classifies input commands', () => {
    expect(commandCategory('click')).toBe('input')
    expect(commandCategory('setValue')).toBe('input')
    expect(commandCategory('dragAndDrop')).toBe('input')
  })

  it('classifies assertion/wait commands', () => {
    expect(commandCategory('isExisting')).toBe('assertion')
    expect(commandCategory('waitForElementVisible')).toBe('assertion')
    expect(commandCategory('waitUntil')).toBe('assertion')
  })

  it('classifies query commands', () => {
    expect(commandCategory('$')).toBe('query')
    expect(commandCategory('getText')).toBe('query')
    expect(commandCategory('getAttribute')).toBe('query')
  })

  it('falls back to other for unknown or misc commands', () => {
    expect(commandCategory('execute')).toBe('other')
    expect(commandCategory('pause')).toBe('other')
    expect(commandCategory('somethingNew')).toBe('other')
  })
})

describe('commandIcon', () => {
  it('distinguishes icons within the query category', () => {
    // both are query-coloured, but get different glyphs like the mockup
    expect(commandIcon('$')).toBe('select')
    expect(commandIcon('getText')).toBe('read')
  })

  it('distinguishes type vs click within input', () => {
    expect(commandIcon('setValue')).toBe('type')
    expect(commandIcon('click')).toBe('click')
  })

  it('maps reload separately from other navigation', () => {
    expect(commandIcon('reloadSession')).toBe('reload')
    expect(commandIcon('url')).toBe('navigate')
  })

  it('maps assertions and falls back to execute', () => {
    expect(commandIcon('waitForElementVisible')).toBe('assert')
    expect(commandIcon('execute')).toBe('execute')
    expect(commandIcon('unknownThing')).toBe('execute')
  })
})
