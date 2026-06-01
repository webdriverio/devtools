import { describe, it, expect } from 'vitest'

import {
  shouldResetForNewRun,
  type RunDetectionState
} from '../src/controller/run-detection.js'
import type { SuiteStatsFragment } from '../src/controller/types.js'

type SuiteChunks = Array<Record<string, SuiteStatsFragment>>

const state = (
  overrides: Partial<RunDetectionState> = {}
): RunDetectionState => ({
  lastSeenRunTimestamp: 0,
  activeRerunSuiteUid: undefined,
  ...overrides
})

const suite = (
  uid: string,
  overrides: Record<string, unknown> = {}
): SuiteStatsFragment =>
  ({
    uid,
    title: uid,
    fullTitle: uid,
    state: 'passed',
    start: new Date(2026, 0, 1, 10, 0, 0),
    end: new Date(2026, 0, 1, 10, 5, 0),
    tests: [],
    suites: [],
    ...overrides
  }) as never as SuiteStatsFragment

const chunks = (...suites: SuiteStatsFragment[]): SuiteChunks =>
  suites.map((s) => ({ [s.uid]: s }))

describe('shouldResetForNewRun', () => {
  it('returns false when an active rerun is in progress', () => {
    const incoming = chunks(suite('root', { start: new Date(2026, 0, 2) }))
    const existing = chunks(suite('root'))
    const result = shouldResetForNewRun(
      incoming,
      state({ activeRerunSuiteUid: 'root' }),
      existing
    )
    expect(result.shouldReset).toBe(false)
    // Tracker still advances so the post-rerun final update isn't mis-detected.
    expect(result.newLastSeenTimestamp).toBeGreaterThan(0)
  })

  it('returns true when a newer start arrives AND the previous run was finished', () => {
    const oldStart = new Date(2026, 0, 1, 10, 0, 0).getTime()
    const incoming = chunks(
      suite('root', { start: new Date(2026, 0, 1, 11, 0, 0) })
    )
    const existing = chunks(
      suite('root', { end: new Date(2026, 0, 1, 10, 30, 0) })
    )
    const result = shouldResetForNewRun(
      incoming,
      state({ lastSeenRunTimestamp: oldStart }),
      existing
    )
    expect(result.shouldReset).toBe(true)
  })

  it('treats an ongoing previous run as a continuation (no reset)', () => {
    const oldStart = new Date(2026, 0, 1, 10, 0, 0).getTime()
    const incoming = chunks(
      suite('root', { start: new Date(2026, 0, 1, 11, 0, 0) })
    )
    // Existing root has no `end` → still running (e.g. cucumber feature
    // spanning multiple scenarios).
    const existing = chunks(suite('root', { end: undefined }))
    const result = shouldResetForNewRun(
      incoming,
      state({ lastSeenRunTimestamp: oldStart }),
      existing
    )
    expect(result.shouldReset).toBe(false)
    // Timestamp still advances.
    expect(result.newLastSeenTimestamp).toBeGreaterThan(oldStart)
  })

  it('returns false when no start timestamp is present', () => {
    const incoming = chunks(suite('root', { start: undefined }))
    const result = shouldResetForNewRun(incoming, state(), [])
    expect(result.shouldReset).toBe(false)
  })

  it('handles array-wrapped and single-chunk payloads identically', () => {
    const existing: SuiteChunks = []
    const oneChunk = { root: suite('root', { start: new Date(2026, 0, 2) }) }
    const asSingle = shouldResetForNewRun(oneChunk, state(), existing)
    const asArray = shouldResetForNewRun([oneChunk], state(), existing)
    expect(asSingle).toEqual(asArray)
  })

  it('skips null chunks in the payload', () => {
    const incoming = [
      null as unknown as Record<string, SuiteStatsFragment>,
      { root: suite('root') }
    ]
    expect(() => shouldResetForNewRun(incoming, state(), [])).not.toThrow()
  })
})
