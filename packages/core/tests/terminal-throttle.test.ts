import { describe, it, expect } from 'vitest'
import {
  TERMINAL_REPEAT_WINDOW_MS,
  TerminalLineThrottle,
  terminalRepeatKey
} from '../src/terminal-throttle.js'

describe('terminalRepeatKey', () => {
  it('strips a leading ISO-8601 timestamp so log frames of the same message match', () => {
    const a = '2026-07-09T22:12:38.497Z INFO webdriver: COMMAND getText("#x")'
    const b = '2026-07-09T22:12:38.597Z INFO webdriver: COMMAND getText("#x")'
    expect(terminalRepeatKey(a)).toBe(terminalRepeatKey(b))
    expect(terminalRepeatKey(a)).toBe('INFO webdriver: COMMAND getText("#x")')
  })

  it('leaves lines without a leading timestamp untouched', () => {
    expect(terminalRepeatKey('[TEST] hello')).toBe('[TEST] hello')
  })
})

describe('TerminalLineThrottle', () => {
  it('emits distinct lines immediately', () => {
    const t = new TerminalLineThrottle()
    expect(t.shouldEmit('one', 0)).toBe(true)
    expect(t.shouldEmit('two', 0)).toBe(true)
    expect(t.shouldEmit('three', 0)).toBe(true)
  })

  it('suppresses a within-window repeat but re-emits once the window passes', () => {
    const t = new TerminalLineThrottle(1000)
    expect(t.shouldEmit('poll', 0)).toBe(true) // first
    expect(t.shouldEmit('poll', 100)).toBe(false) // repeat within window
    expect(t.shouldEmit('poll', 900)).toBe(false)
    expect(t.shouldEmit('poll', 1000)).toBe(true) // window elapsed → re-emit
    expect(t.shouldEmit('poll', 1100)).toBe(false)
  })

  it('anchors the window to the last emit, not the last occurrence (a sustained stream still emits ~1/window)', () => {
    const t = new TerminalLineThrottle(1000)
    let emitted = 0
    // 100ms poll for 10s = 101 occurrences of the same line.
    for (let ms = 0; ms <= 10000; ms += 100) {
      if (t.shouldEmit('COMMAND getText', ms)) {
        emitted++
      }
    }
    // ~1 per second rather than ~100 total — flood collapsed ~10:1.
    expect(emitted).toBe(11)
  })

  it('collapses successive WDIO logger frames of the same command despite changing timestamps', () => {
    const t = new TerminalLineThrottle(1000)
    const line = (ms: number) =>
      `2026-07-09T22:12:${String(30 + Math.floor(ms / 1000)).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}Z INFO webdriver: COMMAND getText("#x")`
    expect(t.shouldEmit(line(0), 0)).toBe(true)
    expect(t.shouldEmit(line(100), 100)).toBe(false)
    expect(t.shouldEmit(line(200), 200)).toBe(false)
  })

  it('treats different messages independently', () => {
    const t = new TerminalLineThrottle(1000)
    expect(t.shouldEmit('COMMAND getText', 0)).toBe(true)
    expect(t.shouldEmit('RESULT ""', 10)).toBe(true) // interleaved, distinct
    expect(t.shouldEmit('COMMAND getText', 100)).toBe(false) // repeat
    expect(t.shouldEmit('RESULT ""', 110)).toBe(false) // repeat
  })

  it('defaults to the exported window constant', () => {
    const t = new TerminalLineThrottle()
    expect(t.shouldEmit('x', 0)).toBe(true)
    expect(t.shouldEmit('x', TERMINAL_REPEAT_WINDOW_MS - 1)).toBe(false)
    expect(t.shouldEmit('x', TERMINAL_REPEAT_WINDOW_MS)).toBe(true)
  })
})
