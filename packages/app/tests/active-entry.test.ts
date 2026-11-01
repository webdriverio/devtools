import { describe, it, expect } from 'vitest'

import {
  activeSpanAt,
  type TimeSpanned
} from '../src/components/workbench/active-entry.js'

describe('activeSpanAt', () => {
  // Point-like commands (no startTime) — the pre-span behaviour must be intact.
  describe('point-like items (no startTime)', () => {
    const points: TimeSpanned[] = [
      { timestamp: 100 },
      { timestamp: 200 },
      { timestamp: 300 },
      { timestamp: 400 }
    ]

    it('returns undefined before the first item', () => {
      expect(activeSpanAt(points, 50)).toBeUndefined()
    })

    it('returns the item exactly at the playback time', () => {
      expect(activeSpanAt(points, 200)).toBe(points[1])
    })

    it('returns the latest item at or before the playback time', () => {
      expect(activeSpanAt(points, 250)).toBe(points[1])
      expect(activeSpanAt(points, 399)).toBe(points[2])
    })

    it('clamps to the last item once playback passes it', () => {
      expect(activeSpanAt(points, 999)).toBe(points[3])
    })

    it('returns undefined for an empty timeline', () => {
      expect(activeSpanAt([], 100)).toBeUndefined()
    })
  })

  describe('spanned items (startTime → timestamp)', () => {
    it('selects a long-running command while the clock is inside its span', () => {
      const before = { timestamp: 1000 }
      const poll = { startTime: 1000, timestamp: 11000 }
      const items: TimeSpanned[] = [before, poll]
      // Mid-poll: the span contains the clock, so the poll stays selected even
      // though the preceding command ended earlier.
      expect(activeSpanAt(items, 5000)).toBe(poll)
      expect(activeSpanAt(items, 1500)).toBe(poll)
      // At the span end the poll is still selected.
      expect(activeSpanAt(items, 11000)).toBe(poll)
    })

    it('picks the most recently started span when several contain the clock', () => {
      const outer = { startTime: 100, timestamp: 10000 }
      const inner = { startTime: 4000, timestamp: 6000 }
      const items: TimeSpanned[] = [outer, inner]
      expect(activeSpanAt(items, 5000)).toBe(inner)
      // Outside the inner span but still inside the outer one → outer.
      expect(activeSpanAt(items, 2000)).toBe(outer)
      expect(activeSpanAt(items, 8000)).toBe(outer)
    })

    it('breaks a start-time tie toward the tighter span', () => {
      const wide = { startTime: 100, timestamp: 9000 }
      const tight = { startTime: 100, timestamp: 3000 }
      const items: TimeSpanned[] = [wide, tight]
      expect(activeSpanAt(items, 2000)).toBe(tight)
    })

    it('falls back to the last-ended item when no span contains the clock', () => {
      const first = { startTime: 100, timestamp: 2000 }
      const second = { startTime: 5000, timestamp: 7000 }
      const items: TimeSpanned[] = [first, second]
      // Clock sits in the gap between the two spans → the last one that ended.
      expect(activeSpanAt(items, 3500)).toBe(first)
    })

    it('returns undefined when the clock precedes the first span', () => {
      const items: TimeSpanned[] = [{ startTime: 1000, timestamp: 5000 }]
      expect(activeSpanAt(items, 500)).toBeUndefined()
    })

    it('prefers a containing span over an already-ended earlier item', () => {
      const ended = { timestamp: 1000 }
      const running = { startTime: 900, timestamp: 8000 }
      const items: TimeSpanned[] = [ended, running]
      // Clock is past the point command but inside the running span → running.
      expect(activeSpanAt(items, 2000)).toBe(running)
    })
  })
})
