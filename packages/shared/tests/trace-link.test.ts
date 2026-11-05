import { describe, expect, it } from 'vitest'

import { formatTraceLink, parseTraceLink } from '../src/trace-player.js'

describe('parseTraceLink', () => {
  it('reads the action and the tab, with or without the leading #', () => {
    expect(parseTraceLink('#action=call@12&tab=network')).toEqual({
      action: 'call@12',
      tab: 'network'
    })
    expect(parseTraceLink('tab=console')).toEqual({ tab: 'console' })
  })

  it('reads an encoded @ as the same id', () => {
    expect(parseTraceLink('#action=call%4012')).toEqual({ action: 'call@12' })
  })

  it('reads nothing from an empty hash', () => {
    expect(parseTraceLink('')).toEqual({})
    expect(parseTraceLink('#')).toEqual({})
  })

  it.each([
    ['an empty value', '#action=&tab='],
    ['a control character', '#action=call%0A1&tab=%3Cb%3E'],
    ['an upper-case tab', '#tab=Network'],
    ['an over-long id', `#action=${'a'.repeat(201)}`]
  ])('leaves out %s', (_name, hash) => {
    expect(parseTraceLink(hash)).toEqual({})
  })

  it('ignores keys it does not know', () => {
    expect(parseTraceLink('#action=call@3&test=x&trace=y')).toEqual({
      action: 'call@3'
    })
  })
})

describe('formatTraceLink', () => {
  it('writes the action then the tab, keeping @ readable', () => {
    expect(formatTraceLink({ tab: 'errors', action: 'call@7' })).toBe(
      'action=call@7&tab=errors'
    )
  })

  it('leaves out what the link does not name', () => {
    expect(formatTraceLink({ tab: 'log' })).toBe('tab=log')
    expect(formatTraceLink({})).toBe('')
  })

  it('round-trips through parseTraceLink', () => {
    const link = { action: 'step-1:a.b', tab: 'a11y' }
    expect(parseTraceLink(formatTraceLink(link))).toEqual(link)
  })

  it('round-trips a foreign callId holding a slash, a space and an ampersand', () => {
    const link = { action: 'hook/before all & x' }
    expect(formatTraceLink(link)).toBe('action=hook%2Fbefore%20all%20%26%20x')
    expect(parseTraceLink(formatTraceLink(link))).toEqual(link)
  })
})
