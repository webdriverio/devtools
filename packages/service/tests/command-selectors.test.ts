import { describe, it, expect } from 'vitest'
import { decorateSelector, nextLastSelector } from '../src/command-selectors.js'
import type { CommandLog } from '../src/types.js'

const entry = (command: string, args: unknown[]): CommandLog =>
  ({ command, args, timestamp: 0 }) as unknown as CommandLog

describe('nextLastSelector', () => {
  it('remembers a locator command selector', () => {
    expect(nextLastSelector('$', ['#username'], undefined)).toBe('#username')
  })

  it('keeps the current selector for non-locator commands', () => {
    expect(nextLastSelector('click', [], '#username')).toBe('#username')
  })

  it('ignores a non-string or empty locator argument', () => {
    expect(nextLastSelector('$', [{}], '#prev')).toBe('#prev')
    expect(nextLastSelector('$', [''], '#prev')).toBe('#prev')
  })
})

describe('decorateSelector', () => {
  it('replaces a bare element handle with the selector', () => {
    const log = entry('click', [{ 'element-6066-11e4-a52e-4f735466cecf': '1' }])
    decorateSelector(log, 'click', log.args, '#submit')
    expect(log.args).toEqual(['#submit'])
    expect(log.selector).toBe('#submit')
  })

  it('stamps the selector without touching real args', () => {
    const log = entry('getAttribute', ['href'])
    decorateSelector(log, 'getAttribute', log.args, '#link')
    expect(log.args).toEqual(['href'])
    expect(log.selector).toBe('#link')
  })

  it('prepends the selector for setValue so params read {selector, value}', () => {
    const log = entry('setValue', ['foobar'])
    decorateSelector(log, 'setValue', log.args, '#username')
    expect(log.args).toEqual(['#username', 'foobar'])
  })

  it('leaves an unrelated command untouched', () => {
    const log = entry('url', ['http://x/'])
    decorateSelector(log, 'url', log.args, '#username')
    expect(log.args).toEqual(['http://x/'])
    expect(log.selector).toBeUndefined()
  })

  it('no-ops when nothing has been resolved yet', () => {
    const log = entry('click', [])
    decorateSelector(log, 'click', log.args, undefined)
    expect(log.args).toEqual([])
    expect(log.selector).toBeUndefined()
  })
})
