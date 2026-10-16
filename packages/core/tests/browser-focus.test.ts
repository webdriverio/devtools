import { describe, expect, it, vi } from 'vitest'

import { restoreBrowserFocus } from '../src/browser-focus.js'

describe('restoreBrowserFocus', () => {
  const launch = () => {
    const calls: unknown[][] = []
    const fn = vi.fn((...args: unknown[]) => {
      calls.push(args)
      return { unref: vi.fn(), on: vi.fn() }
    })
    return { fn, calls }
  }

  it('activates Safari on macOS for a Safari session', () => {
    const { fn, calls } = launch()
    expect(restoreBrowserFocus({ browserName: 'Safari' }, 'darwin', fn)).toBe(
      true
    )
    expect(
      restoreBrowserFocus(
        { browserName: 'safari', host: '127.0.0.1' },
        'darwin',
        fn
      )
    ).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual([
      'open',
      ['-a', 'Safari'],
      { detached: true, stdio: 'ignore' }
    ])
  })

  it('does nothing for another browser, another platform, or no name', () => {
    const { fn } = launch()
    expect(restoreBrowserFocus({ browserName: 'chrome' }, 'darwin', fn)).toBe(
      false
    )
    expect(restoreBrowserFocus({ browserName: 'safari' }, 'linux', fn)).toBe(
      false
    )
    expect(restoreBrowserFocus({}, 'darwin', fn)).toBe(false)
    // iOS Safari through Appium, and a Safari served from a grid, are not this Mac's.
    expect(
      restoreBrowserFocus(
        { browserName: 'Safari', platformName: 'iOS' },
        'darwin',
        fn
      )
    ).toBe(false)
    expect(
      restoreBrowserFocus(
        { browserName: 'safari', host: 'hub.example.com' },
        'darwin',
        fn
      )
    ).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })

  it('reports a launcher that throws rather than throwing', () => {
    expect(
      restoreBrowserFocus({ browserName: 'safari' }, 'darwin', () => {
        throw new Error('no open')
      })
    ).toBe(false)
  })
})
