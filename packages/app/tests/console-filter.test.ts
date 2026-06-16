import { describe, expect, it } from 'vitest'
import {
  filterConsoleLogs,
  formatConsoleArgs,
  stripAnsi
} from '../src/components/workbench/console-filter.js'

const ESC = ''

function log(
  type: ConsoleLogs['type'],
  args: unknown[],
  source?: ConsoleLogs['source']
): ConsoleLogs {
  return { type, args, timestamp: 0, source }
}

describe('stripAnsi', () => {
  it('removes SGR color escape sequences', () => {
    expect(stripAnsi(`${ESC}[90m2026-06-16${ESC}[39m INFO`)).toBe(
      '2026-06-16 INFO'
    )
  })

  it('leaves plain text untouched', () => {
    expect(stripAnsi('no codes here')).toBe('no codes here')
  })
})

describe('formatConsoleArgs', () => {
  it('joins string args with a space', () => {
    expect(formatConsoleArgs(['a', 'b'])).toBe('a b')
  })

  it('strips ANSI codes from logger output', () => {
    expect(formatConsoleArgs([`${ESC}[31mError${ESC}[39m`])).toBe('Error')
  })

  it('pretty-prints non-string args', () => {
    expect(formatConsoleArgs([{ x: 1 }])).toBe('{\n  "x": 1\n}')
  })

  it('falls back to String() for non-arrays', () => {
    expect(formatConsoleArgs(42)).toBe('42')
  })
})

describe('filterConsoleLogs', () => {
  const logs = [
    log('log', ['hello world']),
    log('warn', ['deprecated API']),
    log('error', ['boom failed']),
    log('info', ['connected'])
  ]

  it('returns everything for level "all" and empty search', () => {
    expect(filterConsoleLogs(logs, 'all', '')).toHaveLength(4)
  })

  it('filters by a single level', () => {
    const errs = filterConsoleLogs(logs, 'error', '')
    expect(errs).toHaveLength(1)
    expect(errs[0].args).toEqual(['boom failed'])
  })

  it('treats a missing type as "log"', () => {
    const untyped = [{ args: ['x'], timestamp: 0 } as unknown as ConsoleLogs]
    expect(filterConsoleLogs(untyped, 'log', '')).toHaveLength(1)
  })

  it('matches search case-insensitively against the message', () => {
    const r = filterConsoleLogs(logs, 'all', 'WORLD')
    expect(r).toHaveLength(1)
    expect(r[0].args).toEqual(['hello world'])
  })

  it('combines level and search (both must match)', () => {
    expect(filterConsoleLogs(logs, 'warn', 'boom')).toHaveLength(0)
    expect(filterConsoleLogs(logs, 'warn', 'deprecated')).toHaveLength(1)
  })

  it('ignores leading/trailing whitespace in the search', () => {
    expect(filterConsoleLogs(logs, 'all', '   ')).toHaveLength(4)
  })
})
