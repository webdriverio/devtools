import { describe, it, expect, beforeEach } from 'vitest'
import {
  decorateSelector,
  forgetElementSelectors,
  nextLastSelector,
  rememberElementSelector,
  selectorForCommand
} from '../src/command-selectors.js'
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

// The mutable last-selector slot is overwritten by every locator command, so
// two handles resolved before either is used both read as the second one. The
// element id carried in the serialized handle is the only durable key WDIO's
// hook ever sees.
describe('selectorForCommand', () => {
  const handle = (id: string) => ({ 'element-6066-11e4-a52e-4f735466cecf': id })

  beforeEach(() => forgetElementSelectors())

  it('keeps each interleaved handle on its own selector', () => {
    rememberElementSelector('$', ['#a'], handle('id-a'))
    rememberElementSelector('$', ['#b'], handle('id-b'))
    // `#b` was resolved last, so the slot alone would answer `#b` for both.
    expect(selectorForCommand([handle('id-a')], '#b')).toBe('#a')
    expect(selectorForCommand([handle('id-b')], '#b')).toBe('#b')
  })

  it('stamps the acted-on element, not the most recent locator', () => {
    rememberElementSelector('$', ['#a'], handle('id-a'))
    rememberElementSelector('$', ['#b'], handle('id-b'))
    const log = entry('click', [handle('id-a')])
    decorateSelector(log, 'click', log.args, selectorForCommand(log.args, '#b'))
    expect(log.selector).toBe('#a')
    expect(log.args).toEqual(['#a'])
  })

  it('falls back to the slot when the command carries no handle', () => {
    rememberElementSelector('$', ['#a'], handle('id-a'))
    expect(selectorForCommand([], '#a')).toBe('#a')
    expect(selectorForCommand(['not-a-handle'], '#a')).toBe('#a')
  })

  it('falls back for a handle it never saw resolved', () => {
    expect(selectorForCommand([handle('unknown')], '#last')).toBe('#last')
  })

  it('records nothing for a non-locator command', () => {
    rememberElementSelector('click', ['#a'], handle('id-a'))
    expect(selectorForCommand([handle('id-a')], undefined)).toBeUndefined()
  })

  it('is cleared between tests so a stale element cannot be reclaimed', () => {
    rememberElementSelector('$', ['#a'], handle('id-a'))
    forgetElementSelectors()
    expect(selectorForCommand([handle('id-a')], undefined)).toBeUndefined()
  })

  it('bounds itself so a long run cannot grow it without limit', () => {
    for (let i = 0; i < 5100; i++) {
      rememberElementSelector('$', [`#s${i}`], handle(`id-${i}`))
    }
    // Oldest evicted, newest kept — a test resolving this many elements without
    // a test boundary is a standalone script, not a spec.
    expect(selectorForCommand([handle('id-0')], undefined)).toBeUndefined()
    expect(selectorForCommand([handle('id-5099')], undefined)).toBe('#s5099')
  })
})
