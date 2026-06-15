import { describe, it, expect } from 'vitest'

import { activeTimestampAt } from '../src/components/workbench/active-entry.js'

describe('activeTimestampAt', () => {
  const stamps = [100, 200, 300, 400]

  it('returns undefined before the first action', () => {
    expect(activeTimestampAt(stamps, 50)).toBeUndefined()
  })

  it('returns the action exactly at the playback time', () => {
    expect(activeTimestampAt(stamps, 200)).toBe(200)
  })

  it('returns the latest action at or before the playback time', () => {
    expect(activeTimestampAt(stamps, 250)).toBe(200)
    expect(activeTimestampAt(stamps, 399)).toBe(300)
  })

  it('clamps to the last action once playback passes it', () => {
    expect(activeTimestampAt(stamps, 999)).toBe(400)
  })

  it('returns undefined for an empty timeline', () => {
    expect(activeTimestampAt([], 100)).toBeUndefined()
  })
})
