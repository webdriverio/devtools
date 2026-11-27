import { describe, expect, it } from 'vitest'
import { traceConsole } from '../src/console.js'
import { DEFAULT_CONSOLE_LINE_CHARS } from '../src/constants.js'
import { traceStateOf } from '../src/open-trace.js'
import {
  LONG_LINE,
  openBusyTrace,
  openChromeTrace
} from './console-network-traces.js'
import { allPages, fixtures, openFixture } from './traces.js'

describe('traceConsole over every adapter fixture', () => {
  it.each(fixtures)(
    'lists every line of $zipName in time order',
    async ({ zipName, manifest }) => {
      const all = traceConsole(await openFixture(zipName), {
        levels: [],
        maxChars: 10_000_000
      })
      expect(all.total).toBe(manifest.consoleLogs)
      expect(all.items).toHaveLength(manifest.consoleLogs)
      const times = all.items.map((line) => line.timeMs)
      expect(times).toEqual([...times].sort((a, b) => a - b))
      expect(
        Object.values(all.byLevel).reduce((sum, count) => sum + count, 0)
      ).toBe(manifest.consoleLogs)
    }
  )

  it.each(fixtures)(
    'pages every line of $zipName within the budget, counts included',
    async ({ zipName }) => {
      const handle = await openFixture(zipName)
      for (const maxChars of [1_000, 20_000]) {
        const pages = allPages((cursor) =>
          traceConsole(handle, { levels: [], maxChars, cursor })
        )
        for (const page of pages) {
          expect(JSON.stringify(page).length).toBeLessThanOrEqual(maxChars)
        }
      }
    }
  )

  it('finds the two failure lines a Nightwatch run printed', async () => {
    const nightwatch = fixtures.find(({ zipName }) =>
      zipName.startsWith('nightwatch')
    )!
    const errors = traceConsole(await openFixture(nightwatch.zipName), {
      levels: ['error']
    })
    expect(errors.total).toBe(2)
    expect(errors.items[0]!.text).toContain('NightwatchAssertError')
  })
})

describe('traceConsole', () => {
  it('reports times from the trace start and sources, with no empty fields', async () => {
    const page = traceConsole(await openChromeTrace(), {
      levels: [],
      maxLineChars: 22
    })
    expect(page.items.slice(0, 2)).toEqual([
      {
        timeMs: 300,
        level: 'log',
        source: 'browser',
        text: 'page … (cut, 26 chars)'
      },
      {
        timeMs: 2400,
        level: 'debug',
        source: 'browser',
        text: 'edge inside'
      }
    ])
  })

  it('strips terminal colour codes', async () => {
    const page = traceConsole(await openChromeTrace(), {
      levels: [],
      sources: ['terminal']
    })
    expect(page.items.map((line) => line.text)).toEqual(['✓ login step'])
  })

  it('filters by level and still counts every level the other filters match', async () => {
    const page = traceConsole(await openChromeTrace(), {
      levels: ['error', 'warn']
    })
    expect(page.items.map((line) => line.level)).toEqual([
      'warn',
      'error',
      'error'
    ])
    expect(page.byLevel).toEqual({ log: 2, debug: 2, warn: 1, error: 2 })
  })

  it('filters by a case-insensitive substring', async () => {
    const page = traceConsole(await openChromeTrace(), { text: 'TYPEERROR' })
    expect(page.items.map((line) => line.text)).toEqual([
      'TypeError: user is undefined'
    ])
  })

  it('keeps the lines around an action', async () => {
    const handle = await openChromeTrace()
    const near = traceConsole(handle, {
      levels: [],
      action: 'call@2',
      windowMs: 200
    })
    expect(near.items.map((line) => line.timeMs)).toEqual([5100, 5150, 5300])
    const tight = traceConsole(handle, {
      levels: [],
      action: 'call@2',
      windowMs: 0
    })
    expect(tight.items.map((line) => line.timeMs)).toEqual([5100, 5150])
  })

  it('widens the window around an action by exactly two seconds by default', async () => {
    const page = traceConsole(await openChromeTrace(), {
      levels: [],
      action: 'call@1'
    })
    expect(page.items.map((line) => line.text)).toEqual([
      'page loaded {"ready":true}',
      'edge inside'
    ])
  })

  it('lists error lines only by default, still counting every level', async () => {
    const page = traceConsole(await openChromeTrace())
    expect(page.items.map((line) => line.level)).toEqual(['error', 'error'])
    expect(page.byLevel).toEqual({ log: 2, debug: 2, warn: 1, error: 2 })
  })

  it('reads an empty level or source list as no filter', async () => {
    const handle = await openChromeTrace()
    const all = traceConsole(handle, { levels: [], sources: [] })
    expect(all.total).toBe(7)
    expect(all.total).toBe(traceConsole(handle, { levels: [] }).total)
  })

  it('names maxLineChars when it is not a positive integer', async () => {
    const handle = await openChromeTrace()
    expect(() => traceConsole(handle, { maxLineChars: 0 })).toThrow(
      'maxLineChars must be a positive integer, got 0'
    )
  })

  it('cuts a long line and says how long it was', async () => {
    const page = traceConsole(await openChromeTrace(), { sources: ['test'] })
    const text = page.items[0]!.text
    expect(text).toHaveLength(DEFAULT_CONSOLE_LINE_CHARS)
    expect(text.endsWith(`… (cut, ${LONG_LINE.trim().length} chars)`)).toBe(
      true
    )
    expect(LONG_LINE.startsWith(text.slice(0, 900))).toBe(true)
  })

  it.each([1_000, 1_200, 5_000])(
    'holds every page within %s characters to the end of the listing',
    async (maxChars) => {
      const handle = await openBusyTrace()
      const pages = allPages((cursor) =>
        traceConsole(handle, { levels: [], maxChars, cursor })
      )
      expect(pages.length).toBeGreaterThan(1)
      for (const page of pages) {
        expect(JSON.stringify(page).length).toBeLessThanOrEqual(maxChars)
      }
      expect(pages.flatMap((page) => page.items)).toHaveLength(40)
    }
  )

  it('refuses a cursor from a listing with other filters, and shares one between equal filters', async () => {
    const handle = await openBusyTrace()
    const first = traceConsole(handle, { levels: ['log', 'error'] })
    expect(first.nextCursor).toBeDefined()
    expect(
      traceConsole(handle, {
        levels: ['error', 'log'],
        cursor: first.nextCursor
      }).items.length
    ).toBeGreaterThan(0)
    expect(() =>
      traceConsole(handle, { levels: ['log'], cursor: first.nextCursor })
    ).toThrow(/belongs to a different listing/)
  })

  it('leaves out a source outside the vocabulary', async () => {
    const handle = await openChromeTrace()
    const log = traceStateOf(handle).data.trace.consoleLogs[0]!
    Object.assign(log, { source: 'custom' })
    const line = traceConsole(handle, { levels: [] }).items[0]!
    expect(line).not.toHaveProperty('source')
    expect(line.text).toBe('page loaded {"ready":true}')
  })

  it('refuses a budget below the smallest a query accepts', async () => {
    const handle = await openChromeTrace()
    expect(() => traceConsole(handle, { maxChars: 999 })).toThrow(
      'maxChars must be at least 1000'
    )
  })

  it('refuses an action the trace does not hold', async () => {
    const handle = await openChromeTrace()
    expect(() => traceConsole(handle, { action: 'call@99' })).toThrow(
      'The trace has no action "call@99": pass a callId from the action list'
    )
  })

  it('refuses a window without an action, or a negative one', async () => {
    const handle = await openChromeTrace()
    expect(() => traceConsole(handle, { windowMs: 100 })).toThrow(
      'windowMs needs an action'
    )
    expect(() =>
      traceConsole(handle, { action: 'call@1', windowMs: -1 })
    ).toThrow('windowMs must be a non-negative number')
  })
})
