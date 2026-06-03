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

  it('preserve refuses an empty-command snapshot', () => {
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

  it('clear(uid) removes only the named baseline and returns whether it existed', () => {
    baselineStore.recordEvent('commands', [
      { timestamp: 150, command: 'click', args: [] }
    ])
    baselineStore.recordEvent('suites', suite({ start: 100, end: 200 }))
    baselineStore.preserve(TEST_UID, 'test')

    expect(baselineStore.clear(TEST_UID)).toBe(true)
    expect(baselineStore.clear(TEST_UID)).toBe(false)
    expect(baselineStore.get(TEST_UID)).toBeUndefined()
  })

  it('getPair returns the stored baseline and a fresh snapshot of the latest run', () => {
    // First run: capture + preserve a baseline
    baselineStore.recordEvent('commands', [
      { timestamp: 150, command: 'first', args: [] }
    ])
    baselineStore.recordEvent('suites', suite({ start: 100, end: 200 }))
    const baseline = baselineStore.preserve(TEST_UID, 'test')!

    // Second run: new commands within a new time window
    baselineStore.recordEvent(
      'suites',
      suite({ start: 500, end: 600, childState: 'passed' })
    )
    baselineStore.recordEvent('commands', [
      { timestamp: 550, command: 'second', args: [] }
    ])

    const pair = baselineStore.getPair(TEST_UID, 'test')
    expect(pair.baseline).toBe(baseline)
    expect(pair.latest?.commands.map((c) => c.command)).toEqual(['second'])
  })

  it('getPair returns latest only when no baseline has been preserved', () => {
    baselineStore.recordEvent('commands', [
      { timestamp: 150, command: 'live', args: [] }
    ])
    baselineStore.recordEvent('suites', suite({ start: 100, end: 200 }))

    const pair = baselineStore.getPair(TEST_UID, 'test')
    expect(pair.baseline).toBeUndefined()
    expect(pair.latest?.commands.map((c) => c.command)).toEqual(['live'])
  })

  it('rolls a passing descendant up to a suite without explicit state', () => {
    baselineStore.recordEvent('commands', [
      { timestamp: 150, command: 'ok', args: [] }
    ])
    // Suite has no explicit state; child passes → rollup yields 'passed'
    baselineStore.recordEvent('suites', [
      {
        [SUITE_UID]: {
          uid: SUITE_UID,
          title: 'parent',
          file: '/spec.ts',
          start: 100,
          end: 200,
          tests: [
            {
              uid: TEST_UID,
              title: 'child',
              fullTitle: 'parent child',
              start: 100,
              end: 200,
              state: 'passed'
            }
          ],
          suites: []
        }
      }
    ])

    const snap = baselineStore.snapshot(SUITE_UID, 'suite')!
    expect(snap.test.state).toBe('passed')
  })

  it('filters consoleLogs to the test time window', () => {
    baselineStore.recordEvent('consoleLogs', [
      { type: 'log', args: ['before'], timestamp: 100 },
      { type: 'log', args: ['inside'], timestamp: 250 },
      { type: 'log', args: ['after'], timestamp: 900 }
    ])
    baselineStore.recordEvent('commands', [
      { timestamp: 250, command: 'click', args: [] }
    ])
    baselineStore.recordEvent('suites', suite({ start: 200, end: 300 }))

    const snap = baselineStore.snapshot(TEST_UID, 'test')!
    expect(snap.consoleLogs.map((c) => c.args[0])).toEqual(['inside'])
  })

  it('filters mutations to the test time window', () => {
    baselineStore.recordEvent('mutations', [
      { type: 'attributes', timestamp: 100, addedNodes: [], removedNodes: [] },
      { type: 'attributes', timestamp: 250, addedNodes: [], removedNodes: [] },
      { type: 'attributes', timestamp: 900, addedNodes: [], removedNodes: [] }
    ])
    baselineStore.recordEvent('commands', [
      { timestamp: 250, command: 'click', args: [] }
    ])
    baselineStore.recordEvent('suites', suite({ start: 200, end: 300 }))

    const snap = baselineStore.snapshot(TEST_UID, 'test')!
    expect(
      snap.mutations.map((m) => (m as { timestamp: number }).timestamp)
    ).toEqual([250])
  })

  it('filters networkRequests by span overlap with the window', () => {
    baselineStore.recordEvent('networkRequests', [
      // ends before window
      {
        id: '1',
        startTime: 50,
        endTime: 150,
        url: '/a',
        method: 'GET',
        timestamp: 50,
        type: 'fetch'
      },
      // overlaps window
      {
        id: '2',
        startTime: 250,
        endTime: 280,
        url: '/b',
        method: 'GET',
        timestamp: 250,
        type: 'fetch'
      },
      // starts after window
      {
        id: '3',
        startTime: 500,
        endTime: 600,
        url: '/c',
        method: 'GET',
        timestamp: 500,
        type: 'fetch'
      }
    ])
    baselineStore.recordEvent('commands', [
      { timestamp: 250, command: 'click', args: [] }
    ])
    baselineStore.recordEvent('suites', suite({ start: 200, end: 300 }))

    const snap = baselineStore.snapshot(TEST_UID, 'test')!
    expect(snap.networkRequests.map((r) => r.url)).toEqual(['/b'])
  })

  it('preserve returns undefined when the uid has no recorded node', () => {
    expect(baselineStore.preserve('unknown-uid', 'test')).toBeUndefined()
  })

  it('preserve at suite scope captures the parent windowing leaf commands', () => {
    baselineStore.recordEvent('commands', [
      { timestamp: 150, command: 'one', args: [] },
      { timestamp: 250, command: 'two', args: [] }
    ])
    baselineStore.recordEvent('suites', suite({ start: 100, end: 300 }))

    const attempt = baselineStore.preserve(SUITE_UID, 'suite')!
    expect(attempt.scope).toBe('suite')
    expect(attempt.commands.map((c) => c.command)).toEqual(['one', 'two'])
  })

  it('recordEvent ignores falsy data', () => {
    // No throw and no side effect
    baselineStore.recordEvent('commands', null)
    baselineStore.recordEvent('commands', undefined)
    baselineStore.recordEvent('commands', 0 as never)

    baselineStore.recordEvent('suites', suite({ start: 100, end: 200 }))
    // Empty array also no-ops without throwing
    baselineStore.recordEvent('commands', [])
    expect(baselineStore.snapshot(TEST_UID, 'test')?.commands ?? []).toEqual([])
  })

  it('recordEvent merges sources via assign', () => {
    baselineStore.recordEvent('sources', { '/a.ts': 'A' })
    baselineStore.recordEvent('sources', { '/b.ts': 'B' })
    baselineStore.recordEvent('commands', [
      { timestamp: 150, command: 'click', args: [] }
    ])
    baselineStore.recordEvent('suites', suite({ start: 100, end: 200 }))

    const snap = baselineStore.snapshot(TEST_UID, 'test')!
    expect(snap.sources).toEqual({ '/a.ts': 'A', '/b.ts': 'B' })
  })

  it('networkRequests are deduped by id across multiple recordEvent calls', () => {
    const base = {
      startTime: 250,
      endTime: 260,
      method: 'GET',
      timestamp: 250,
      type: 'fetch'
    }
    baselineStore.recordEvent('networkRequests', [
      { id: '1', url: '/a', ...base }
    ])
    baselineStore.recordEvent('networkRequests', [
      { id: '1', url: '/a-updated', ...base },
      { id: '2', url: '/b', ...base }
    ])
    baselineStore.recordEvent('commands', [
      { timestamp: 250, command: 'click', args: [] }
    ])
    baselineStore.recordEvent('suites', suite({ start: 200, end: 300 }))

    const snap = baselineStore.snapshot(TEST_UID, 'test')!
    expect(snap.networkRequests.map((r) => r.url)).toEqual(['/a-updated', '/b'])
  })

  it('rolls a running descendant up so a suite without explicit state shows running', () => {
    baselineStore.recordEvent('commands', [
      { timestamp: 150, command: 'go', args: [] }
    ])
    baselineStore.recordEvent('suites', [
      {
        [SUITE_UID]: {
          uid: SUITE_UID,
          title: 'parent',
          file: '/spec.ts',
          start: 100,
          end: 200,
          tests: [
            {
              uid: TEST_UID,
              title: 'child',
              fullTitle: 'parent child',
              start: 100,
              state: 'running'
            }
          ],
          suites: []
        }
      }
    ])

    const snap = baselineStore.snapshot(SUITE_UID, 'suite')!
    expect(snap.test.state).toBe('running')
  })
})
