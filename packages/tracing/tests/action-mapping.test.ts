import { describe, it, expect } from 'vitest'
import {
  mapCommandToAction,
  formatActionTitle,
  ELEMENT_COMMANDS
} from '../src/action-mapping.js'

describe('mapCommandToAction', () => {
  it('maps url to Page.navigate', () => {
    expect(mapCommandToAction('url')).toEqual({
      class: 'Page',
      method: 'navigate'
    })
  })

  it('maps click to Element.click', () => {
    expect(mapCommandToAction('click')).toEqual({
      class: 'Element',
      method: 'click'
    })
  })

  it('returns null for unknown commands', () => {
    expect(mapCommandToAction('takeScreenshot')).toBeNull()
    expect(mapCommandToAction('findElement')).toBeNull()
  })

  it('returns null for internal commands', () => {
    expect(mapCommandToAction('getTitle')).toBeNull()
  })
})

describe('formatActionTitle', () => {
  it('formats action with argument', () => {
    const action = { class: 'Page', method: 'navigate' }
    expect(formatActionTitle(action, 'url', ['https://example.com'])).toBe(
      'Page.navigate("https://example.com")'
    )
  })

  it('formats action without argument', () => {
    const action = { class: 'Page', method: 'reload' }
    expect(formatActionTitle(action, 'refresh', [])).toBe('Page.reload()')
  })

  it('truncates long first argument to 80 chars', () => {
    const action = { class: 'Page', method: 'navigate' }
    const longUrl = 'https://example.com/' + 'x'.repeat(100)
    const title = formatActionTitle(action, 'url', [longUrl])
    expect(title.length).toBeLessThanOrEqual(
      80 + 'Page.navigate("".'.length + 2
    )
  })
})

describe('ELEMENT_COMMANDS', () => {
  it('contains click and setValue', () => {
    expect(ELEMENT_COMMANDS.has('click')).toBe(true)
    expect(ELEMENT_COMMANDS.has('setValue')).toBe(true)
  })

  it('does not contain navigation commands', () => {
    expect(ELEMENT_COMMANDS.has('url')).toBe(false)
    expect(ELEMENT_COMMANDS.has('refresh')).toBe(false)
  })

  it('does not contain clearValue or addValue (fired internally by setValue)', () => {
    expect(ELEMENT_COMMANDS.has('clearValue')).toBe(false)
    expect(ELEMENT_COMMANDS.has('addValue')).toBe(false)
    expect(mapCommandToAction('clearValue')).toBeNull()
    expect(mapCommandToAction('addValue')).toBeNull()
  })
})
