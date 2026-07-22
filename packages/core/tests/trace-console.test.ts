import { describe, it, expect } from 'vitest'
import { buildConsoleEvents } from '@wdio/devtools-core'
import type { ConsoleLog } from '@wdio/devtools-shared'

const WALL_TIME = 1000
const PAGE_ID = 'page@abc123'

function log(overrides: Partial<ConsoleLog> = {}): ConsoleLog {
  return {
    type: 'log',
    args: ['hello'],
    timestamp: WALL_TIME + 50,
    source: 'browser',
    ...overrides
  }
}

describe('buildConsoleEvents', () => {
  it('returns empty array for no logs', () => {
    expect(buildConsoleEvents([], PAGE_ID, WALL_TIME)).toEqual([])
  })

  it('maps browser logs to console events with monotonic offsets', () => {
    const events = buildConsoleEvents([log()], PAGE_ID, WALL_TIME)
    expect(events).toEqual([
      {
        type: 'console',
        time: 50,
        pageId: PAGE_ID,
        messageType: 'log',
        text: 'hello',
        args: [{ preview: 'hello', value: 'hello' }],
        location: { url: '', lineNumber: 0, columnNumber: 0 }
      }
    ])
  })

  it('treats untagged logs as browser console', () => {
    const events = buildConsoleEvents(
      [log({ source: undefined })],
      PAGE_ID,
      WALL_TIME
    )
    expect(events[0]!.type).toBe('console')
  })

  it("maps 'warn' to 'warning' and 'trace' to 'debug'", () => {
    const events = buildConsoleEvents(
      [log({ type: 'warn' }), log({ type: 'trace' })],
      PAGE_ID,
      WALL_TIME
    )
    expect(
      events.map((e) => (e.type === 'console' ? e.messageType : ''))
    ).toEqual(['warning', 'debug'])
  })

  it('previews non-string args as JSON and joins into text', () => {
    const events = buildConsoleEvents(
      [log({ args: ['count', { a: 1 }, 2] })],
      PAGE_ID,
      WALL_TIME
    )
    const event = events[0]!
    expect(event.type).toBe('console')
    if (event.type === 'console') {
      expect(event.text).toBe('count {"a":1} 2')
      expect(event.args?.[1]).toEqual({ preview: '{"a":1}', value: { a: 1 } })
    }
  })

  it('routes test/terminal logs to stdout/stderr by level with source kept', () => {
    const events = buildConsoleEvents(
      [
        log({ source: 'test', type: 'log', args: ['out'] }),
        log({ source: 'test', type: 'error', args: ['bad'] }),
        log({ source: 'terminal', type: 'warn', args: ['careful'] })
      ],
      PAGE_ID,
      WALL_TIME
    )
    expect(events).toEqual([
      { type: 'stdout', timestamp: 50, text: 'out', source: 'test' },
      { type: 'stderr', timestamp: 50, text: 'bad', source: 'test' },
      { type: 'stderr', timestamp: 50, text: 'careful', source: 'terminal' }
    ])
  })

  it('floors offsets at zero for logs before wallTime', () => {
    const events = buildConsoleEvents(
      [log({ timestamp: WALL_TIME - 500 })],
      PAGE_ID,
      WALL_TIME
    )
    const event = events[0]!
    expect(event.type === 'console' ? event.time : -1).toBe(0)
  })

  it('caps output and appends a truncation marker', () => {
    const logs = Array.from({ length: 10_001 }, (_, i) =>
      log({ timestamp: WALL_TIME + i })
    )
    const events = buildConsoleEvents(logs, PAGE_ID, WALL_TIME)
    expect(events).toHaveLength(10_001)
    const last = events[events.length - 1]!
    expect(last.type).toBe('stderr')
    if (last.type === 'stderr') {
      expect(last.text).toContain('dropped 1 entries')
    }
  })
})
