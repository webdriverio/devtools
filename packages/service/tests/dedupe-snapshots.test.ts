import { describe, it, expect } from 'vitest'
import type { ActionSnapshot } from '@wdio/devtools-shared'
import { dedupeSnapshotsByTimestamp } from '../src/snapshot-dedupe.js'

function snap(timestamp: number, screenshot: string): ActionSnapshot {
  return { timestamp, command: 'click', screenshot }
}

describe('dedupeSnapshotsByTimestamp', () => {
  it('keeps the largest screenshot when timestamps collide', () => {
    // A navigated action's content result and the blank pre/final captures all
    // land on the same timestamp; the richest (content) frame must win.
    const blank = 'AA'
    const content = 'A'.repeat(100)
    const result = dedupeSnapshotsByTimestamp([
      snap(100, content),
      snap(100, blank),
      snap(100, blank)
    ])
    expect(result).toHaveLength(1)
    expect(result[0].screenshot).toBe(content)
  })

  it('keeps distinct timestamps and returns them sorted', () => {
    const result = dedupeSnapshotsByTimestamp([
      snap(300, 'c'),
      snap(100, 'a'),
      snap(200, 'b')
    ])
    expect(result.map((s) => s.timestamp)).toEqual([100, 200, 300])
  })

  it('handles an empty list', () => {
    expect(dedupeSnapshotsByTimestamp([])).toEqual([])
  })
})
