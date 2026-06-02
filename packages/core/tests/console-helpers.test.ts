import { describe, it, expect } from 'vitest'
import {
  chromeLogLevelToLogLevel,
  mapChromeBrowserLogs
} from '../src/console.js'

describe('chromeLogLevelToLogLevel', () => {
  it('maps Chrome severities (case-insensitively) and falls back to "log"', () => {
    expect(chromeLogLevelToLogLevel('SEVERE')).toBe('error')
    expect(chromeLogLevelToLogLevel('warning')).toBe('warn') // case-insensitive
    expect(chromeLogLevelToLogLevel('INFO')).toBe('info')
    expect(chromeLogLevelToLogLevel('DEBUG')).toBe('debug')
    expect(chromeLogLevelToLogLevel('')).toBe('log')
    expect(chromeLogLevelToLogLevel('GIBBERISH')).toBe('log')
  })

  it('accepts {name, value} objects (selenium-webdriver Level shape)', () => {
    expect(chromeLogLevelToLogLevel({ name: 'SEVERE', value: 1000 })).toBe(
      'error'
    )
    expect(chromeLogLevelToLogLevel({ name: undefined })).toBe('log')
  })
})

describe('mapChromeBrowserLogs', () => {
  // One comprehensive test: source-tagging, severity normalization,
  // timestamp passthrough, message → args wrap.
  it('produces ConsoleLog entries tagged source="browser" with normalized levels', () => {
    const out = mapChromeBrowserLogs([
      { level: 'SEVERE', message: 'oh no', timestamp: 100 },
      {
        level: { name: 'WARNING' } as unknown as string,
        message: 'fyi',
        timestamp: 200
      }
    ])
    expect(out).toEqual([
      { source: 'browser', type: 'error', args: ['oh no'], timestamp: 100 },
      { source: 'browser', type: 'warn', args: ['fyi'], timestamp: 200 }
    ])
  })

  it('returns empty array for empty input', () => {
    expect(mapChromeBrowserLogs([])).toEqual([])
  })
})
