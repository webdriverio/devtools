import { describe, it, expect } from 'vitest'

import {
  markAllRunning,
  markSpecificRunning,
  markRunningAsStopped
} from '../src/controller/mark-running.js'
import type {
  SuiteStatsFragment,
  TestStatsFragment
} from '../src/controller/types.js'

type SuiteChunks = Array<Record<string, SuiteStatsFragment>>

const test = (
  uid: string,
  overrides: Record<string, unknown> = {}
): TestStatsFragment =>
  ({
    uid,
    title: uid,
    fullTitle: uid,
    state: 'passed',
    start: new Date(2026, 0, 1),
    end: new Date(2026, 0, 2),
    ...overrides
  }) as never as TestStatsFragment

const suite = (
  uid: string,
  overrides: Record<string, unknown> = {}
): SuiteStatsFragment =>
  ({
    uid,
    title: uid,
    fullTitle: uid,
    state: 'passed',
    start: new Date(2026, 0, 1),
    end: new Date(2026, 0, 2),
    tests: [],
    suites: [],
    ...overrides
  }) as never as SuiteStatsFragment

const chunks = (...suites: SuiteStatsFragment[]): SuiteChunks =>
  suites.map((s) => ({ [s.uid]: s }))

describe('markAllRunning', () => {
  it('marks the root suite and all descendants as running, clearing leaf tests', () => {
    const input = chunks(
      suite('root', {
        tests: [test('t1'), test('t2')],
        suites: [
          suite('child', {
            tests: [test('c1', { state: 'failed' })]
          })
        ]
      })
    )
    const out = markAllRunning(input)
    const root = out[0].root
    expect(root.state).toBe('running')
    expect(root.end).toBeUndefined()
    expect(root.tests).toEqual([])
    expect(root.suites?.[0]?.state).toBe('running')
    expect(root.suites?.[0]?.tests).toEqual([])
  })

  it('skips null/undefined suite entries without throwing', () => {
    const input = chunks(suite('a'))
    // Inject an undefined entry — markAllRunning must preserve it.
    ;(input[0] as Record<string, unknown>)['ghost'] = undefined
    const out = markAllRunning(input)
    expect(out[0].ghost).toBeUndefined()
    expect(out[0].a.state).toBe('running')
  })
})

describe('markSpecificRunning', () => {
  it('marks a matched suite subtree as running when entryType is suite', () => {
    const input = chunks(
      suite('root', {
        suites: [suite('target'), suite('sibling', { state: 'failed' })]
      })
    )
    const out = markSpecificRunning(input, 'target', 'suite')
    const root = out[0].root
    const target = root.suites?.find((s) => s.uid === 'target')
    const sibling = root.suites?.find((s) => s.uid === 'sibling')
    expect(target?.state).toBe('running')
    expect(target?.end).toBeUndefined()
    expect(sibling?.state).toBe('failed') // untouched
  })

  it('marks a matched test as pending and only flips parent suite state', () => {
    const input = chunks(
      suite('root', {
        state: 'passed',
        tests: [test('t1'), test('t2', { state: 'failed' })]
      })
    )
    const out = markSpecificRunning(input, 't1', 'test')
    const root = out[0].root
    const t1 = root.tests?.find((t) => t.uid === 't1')
    const t2 = root.tests?.find((t) => t.uid === 't2')
    expect(t1?.state).toBe('pending')
    expect(t1?.end).toBeUndefined()
    expect(t2?.state).toBe('failed') // untouched
    expect(root.state).toBe('running')
  })

  it("preserves a parent suite's running start/end on a second child match", () => {
    const originalStart = new Date(2026, 0, 1)
    const input = chunks(
      suite('root', {
        state: 'running',
        start: originalStart,
        end: undefined,
        tests: [test('t1', { state: 'pending' })]
      })
    )
    const out = markSpecificRunning(input, 't1', 'test')
    expect(out[0].root.start).toEqual(originalStart) // not reset
  })

  it('returns the suite unchanged when no descendant matches', () => {
    const input = chunks(
      suite('root', {
        state: 'passed',
        tests: [test('t1')]
      })
    )
    const out = markSpecificRunning(input, 'no-such-uid', 'test')
    expect(out[0].root.state).toBe('passed')
    expect(out[0].root.tests?.[0]?.state).toBe('passed')
  })
})

describe('markRunningAsStopped', () => {
  it('marks running tests (no end) as failed with a TestStoppedError', () => {
    const input = chunks(
      suite('root', {
        tests: [test('t1', { state: 'running', end: null })]
      })
    )
    const out = markRunningAsStopped(input)
    const t1 = out[0].root.tests?.[0]
    expect(t1?.state).toBe('failed')
    expect(t1?.error?.name).toBe('TestStoppedError')
    expect(t1?.end).toBeInstanceOf(Date)
  })

  it('leaves already-terminal tests untouched', () => {
    const input = chunks(
      suite('root', {
        tests: [test('t1', { state: 'passed' })]
      })
    )
    const out = markRunningAsStopped(input)
    expect(out[0].root.tests?.[0]?.state).toBe('passed')
    expect(out[0].root.tests?.[0]?.error).toBeUndefined()
  })

  it('derives suite state="failed" when no terminal children remain after stop', () => {
    const input = chunks(
      suite('root', {
        state: 'running',
        end: null,
        tests: [test('t1', { state: 'running', end: null })]
      })
    )
    const out = markRunningAsStopped(input)
    expect(out[0].root.state).toBe('failed')
    expect(out[0].root.end).toBeInstanceOf(Date)
  })

  it('recurses into nested suites', () => {
    const input = chunks(
      suite('root', {
        state: 'running',
        end: null,
        suites: [
          suite('child', {
            state: 'running',
            end: null,
            tests: [test('c1', { state: 'running', end: null })]
          })
        ]
      })
    )
    const out = markRunningAsStopped(input)
    expect(out[0].root.suites?.[0]?.state).toBe('failed')
    expect(out[0].root.suites?.[0]?.tests?.[0]?.state).toBe('failed')
  })
})
