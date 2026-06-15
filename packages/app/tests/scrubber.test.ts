import { describe, it, expect } from 'vitest'
import type { CommandLog } from '@wdio/devtools-shared'

import {
  computeMarkers,
  formatClock
} from '../src/components/browser/scrubber.js'

const cmd = (command: string, ts: number): CommandLog => ({
  command,
  args: [],
  timestamp: ts
})

describe('formatClock', () => {
  it('formats seconds as m:ss with zero-padded seconds', () => {
    expect(formatClock(3)).toBe('0:03')
    expect(formatClock(9)).toBe('0:09')
    expect(formatClock(75)).toBe('1:15')
    expect(formatClock(600)).toBe('10:00')
  })

  it('floors fractional seconds', () => {
    expect(formatClock(3.9)).toBe('0:03')
  })

  it('clamps non-finite and negative values to 0:00', () => {
    expect(formatClock(NaN)).toBe('0:00')
    expect(formatClock(-5)).toBe('0:00')
    expect(formatClock(Infinity)).toBe('0:00')
  })
})

describe('computeMarkers', () => {
  it('maps each command to its fraction of the recording window', () => {
    const start = 1000
    const duration = 1000
    const markers = computeMarkers(
      [cmd('url', 1000), cmd('click', 1500), cmd('getText', 2000)],
      start,
      duration
    )
    expect(markers.map((m) => m.fraction)).toEqual([0, 0.5, 1])
    expect(markers.map((m) => m.category)).toEqual([
      'navigation',
      'input',
      'query'
    ])
    expect(markers.map((m) => m.label)).toEqual(['url', 'click', 'getText'])
  })

  it('prefers command.startTime over timestamp when present', () => {
    const markers = computeMarkers(
      [{ command: 'click', args: [], timestamp: 9999, startTime: 1500 }],
      1000,
      1000
    )
    expect(markers[0].fraction).toBe(0.5)
  })

  it('drops commands outside the recording window', () => {
    const markers = computeMarkers(
      [cmd('url', 500), cmd('click', 1500), cmd('getText', 5000)],
      1000,
      1000
    )
    expect(markers.map((m) => m.label)).toEqual(['click'])
  })

  it('returns no markers when duration is zero or negative', () => {
    expect(computeMarkers([cmd('url', 1000)], 1000, 0)).toEqual([])
    expect(computeMarkers([cmd('url', 1000)], 1000, -1)).toEqual([])
  })

  it('skips commands with a non-numeric timestamp', () => {
    const markers = computeMarkers(
      [{ command: 'url', args: [] } as unknown as CommandLog],
      1000,
      1000
    )
    expect(markers).toEqual([])
  })
})
