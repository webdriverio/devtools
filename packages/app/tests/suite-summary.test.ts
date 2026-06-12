import { describe, it, expect } from 'vitest'

import {
  computeSuiteSummary,
  deriveRunStatus,
  type SuiteSummary
} from '../src/components/sidebar/suite-summary.js'
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
    ...overrides
  }) as never as TestStatsFragment

const suite = (
  uid: string,
  overrides: Record<string, unknown> = {}
): SuiteStatsFragment =>
  ({
    uid,
    title: uid,
    state: 'passed',
    tests: [],
    suites: [],
    ...overrides
  }) as never as SuiteStatsFragment

const chunks = (...suites: SuiteStatsFragment[]): SuiteChunks =>
  suites.map((s) => ({ [s.uid]: s }))

const summary = (overrides: Partial<SuiteSummary>): SuiteSummary => ({
  passed: 0,
  failed: 0,
  running: 0,
  skipped: 0,
  pending: 0,
  total: 0,
  ...overrides
})

describe('computeSuiteSummary', () => {
  it('returns an empty summary for undefined input', () => {
    expect(computeSuiteSummary(undefined)).toEqual(summary({}))
  })

  it('counts leaf tests by state across nested suites', () => {
    const input = chunks(
      suite('root', {
        tests: [test('t1'), test('t2', { state: 'failed' })],
        suites: [
          suite('child', {
            tests: [
              test('c1', { state: 'running' }),
              test('c2', { state: 'skipped' }),
              test('c3', { state: 'pending' })
            ]
          })
        ]
      })
    )
    expect(computeSuiteSummary(input)).toEqual(
      summary({
        passed: 1,
        failed: 1,
        running: 1,
        skipped: 1,
        pending: 1,
        total: 5
      })
    )
  })

  it('treats missing/undefined state as pending', () => {
    const input = chunks(
      suite('root', { tests: [test('t1', { state: undefined })] })
    )
    expect(computeSuiteSummary(input)).toEqual(
      summary({ pending: 1, total: 1 })
    )
  })

  it('does not double-count nested suites present in the flat registry', () => {
    const child = suite('child', { parent: 'root', tests: [test('c1')] })
    const root = suite('root', { tests: [test('t1')], suites: [child] })
    // The registry holds both root and child; child carries a parent so it is
    // only counted via recursion from root, not as its own root.
    const input: SuiteChunks = [{ root }, { child }]
    expect(computeSuiteSummary(input)).toEqual(summary({ passed: 2, total: 2 }))
  })

  it('skips undefined registry entries without throwing', () => {
    const input = chunks(suite('root', { tests: [test('t1')] }))
    ;(input[0] as Record<string, unknown>)['ghost'] = undefined
    expect(computeSuiteSummary(input)).toEqual(summary({ passed: 1, total: 1 }))
  })
})

describe('deriveRunStatus', () => {
  it('is idle when there are no tests', () => {
    expect(deriveRunStatus(summary({}))).toBe('idle')
  })

  it('is idle when every test is still pending (never run)', () => {
    expect(deriveRunStatus(summary({ pending: 3, total: 3 }))).toBe('idle')
  })

  it('is running when a test is running', () => {
    expect(deriveRunStatus(summary({ running: 1, passed: 2, total: 3 }))).toBe(
      'running'
    )
  })

  it('is running when terminal results coexist with pending ones', () => {
    expect(deriveRunStatus(summary({ passed: 2, pending: 1, total: 3 }))).toBe(
      'running'
    )
  })

  it('is failed when a finished run has any failure', () => {
    expect(deriveRunStatus(summary({ passed: 2, failed: 1, total: 3 }))).toBe(
      'failed'
    )
  })

  it('is passed when every test finished without failure', () => {
    expect(deriveRunStatus(summary({ passed: 3, total: 3 }))).toBe('passed')
  })

  it('prefers running over a stale failure count from a prior run', () => {
    expect(deriveRunStatus(summary({ failed: 1, running: 1, total: 2 }))).toBe(
      'running'
    )
  })
})
