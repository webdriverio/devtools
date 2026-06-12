import { describe, it, expect } from 'vitest'

import {
  formatDuration,
  durationHeat,
  stepDurations
} from '../src/components/workbench/actionItems/duration.js'

describe('formatDuration', () => {
  it('shows milliseconds under a second', () => {
    expect(formatDuration(0)).toBe('0ms')
    expect(formatDuration(276)).toBe('276ms')
    expect(formatDuration(1000)).toBe('1000ms')
  })

  it('shows seconds with two decimals under a minute', () => {
    expect(formatDuration(1430)).toBe('1.43s')
    expect(formatDuration(10760)).toBe('10.76s')
  })

  it('shows minutes and seconds above a minute', () => {
    expect(formatDuration(60001)).toBe('1m 0s')
    expect(formatDuration(150000)).toBe('2m 30s')
  })
})

describe('durationHeat', () => {
  it('is fast below 500ms', () => {
    expect(durationHeat(0)).toBe('fast')
    expect(durationHeat(499)).toBe('fast')
  })

  it('is mid from 500ms up to 2s', () => {
    expect(durationHeat(500)).toBe('mid')
    expect(durationHeat(1999)).toBe('mid')
  })

  it('is slow at 2s and above', () => {
    expect(durationHeat(2000)).toBe('slow')
    expect(durationHeat(10760)).toBe('slow')
  })
})

describe('stepDurations', () => {
  it('uses the gap to the next entry for all but the last', () => {
    expect(stepDurations([0, 100, 350, 1350])).toEqual([100, 250, 1000, 1000])
  })

  it('falls back to the previous gap for the final entry so it is never blank', () => {
    // last entry (1350) has no next → reuses the prior gap (1350 - 350 = 1000)
    const out = stepDurations([0, 350, 1350])
    expect(out[out.length - 1]).toBe(1000)
  })

  it('returns undefined for a single lone entry', () => {
    expect(stepDurations([42])).toEqual([undefined])
  })

  it('handles an empty timeline', () => {
    expect(stepDurations([])).toEqual([])
  })

  it('keeps 0ms gaps for same-timestamp commands', () => {
    expect(stepDurations([0, 0, 0, 500])).toEqual([0, 0, 500, 500])
  })
})
