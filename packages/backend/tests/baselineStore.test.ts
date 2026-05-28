import { describe, it, expect, beforeEach } from 'vitest'

import { baselineStore } from '../src/baselineStore.js'

const SUITE_UID = 'suite-1'
const TEST_UID = 'test-1'

function suite(opts: {
  start: number
  end?: number
  state?: 'passed' | 'failed' | 'pending' | 'running'
  childState?: 'passed' | 'failed'
  childError?: { message: string }
}) {
  return [
    {
      [SUITE_UID]: {
        uid: SUITE_UID,
        title: 'My Suite',
        file: '/spec.ts',
        start: opts.start,
        end: opts.end,
        state: opts.state,
        tests: [
          {
            uid: TEST_UID,
            title: 'should do a thing',
            fullTitle: 'My Suite should do a thing',
            start: opts.start,
            end: opts.end,
            state: opts.childState,
            error: opts.childError
          }
        ],
        suites: []
      }
    }
  ]
}

describe('baselineStore', () => {
  beforeEach(() => {
    baselineStore.resetActiveRun()
    baselineStore.clearAll()
  })

  it('filters commands to the test time window and ignores commands outside it', () => {
    baselineStore.recordEvent('commands', [
      { timestamp: 100, command: 'before', args: [] },
      { timestamp: 250, command: 'inside', args: [] },
      { timestamp: 900, command: 'after', args: [] }
    ])
    baselineStore.recordEvent('suites', suite({ start: 200, end: 300 }))

    const snap = baselineStore.snapshot(TEST_UID, 'test')!
    expect(snap.commands.map((c) => c.command)).toEqual(['inside'])
    expect(baselineStore.snapshot('does-not-exist', 'test')).toBeUndefined()
  })

  it('replaces (not unions) the time window when a new run is detected', () => {
    baselineStore.recordEvent(
      'suites',
      suite({
        start: 100,
        end: 200,
        state: 'failed',
        childState: 'failed',
        childError: { message: 'old failure' }
      })
    )
    baselineStore.recordEvent('commands', [
      { timestamp: 150, command: 'first-run', args: [] }
    ])
    // Incoming.start > previous.end → isNewRun
    baselineStore.recordEvent(
      'suites',
      suite({ start: 500, end: 600, state: 'passed', childState: 'passed' })
    )
    baselineStore.recordEvent('commands', [
      { timestamp: 550, command: 'second-run', args: [] }
    ])

    const snap = baselineStore.snapshot(TEST_UID, 'test')!
    expect(snap.window).toEqual({ start: 500, end: 600 })
    expect(snap.commands.map((c) => c.command)).toEqual(['second-run'])
    // State + error reset on the new run — no stale failure leak.
    expect(snap.test.state).toBe('passed')
    expect(snap.test.error).toBeUndefined()
  })

  it("rolls a failing descendant's state + error up to a suite-scope snapshot", () => {
    baselineStore.recordEvent('commands', [
      { timestamp: 150, command: 'click', args: [] }
    ])
    baselineStore.recordEvent(
      'suites',
      suite({
        start: 100,
        end: 200,
        childState: 'failed',
        childError: { message: 'expected X, got Y' }
      })
    )

    const snap = baselineStore.snapshot(SUITE_UID, 'suite')!
    expect(snap.test.state).toBe('failed')
    expect(snap.test.error?.message).toBe('expected X, got Y')
    expect(snap.steps?.[0]).toMatchObject({
      uid: TEST_UID,
      state: 'failed'
    })
  })

  it('preserve refuses an empty-command snapshot (the 409 case)', () => {
    baselineStore.recordEvent('suites', suite({ start: 100, end: 200 }))
    expect(baselineStore.preserve(TEST_UID, 'test')).toBeUndefined()
    expect(baselineStore.get(TEST_UID)).toBeUndefined()
  })

  it('preserve stores; clearAll wipes every baseline and returns their uids', () => {
    baselineStore.recordEvent('commands', [
      { timestamp: 150, command: 'click', args: [] }
    ])
    baselineStore.recordEvent('suites', suite({ start: 100, end: 200 }))

    const attempt = baselineStore.preserve(TEST_UID, 'test')!
    expect(baselineStore.get(TEST_UID)).toBe(attempt)

    expect(baselineStore.clearAll()).toEqual([TEST_UID])
    expect(baselineStore.get(TEST_UID)).toBeUndefined()
  })
})
