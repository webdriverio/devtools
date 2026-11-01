import { describe, it, expect } from 'vitest'
import { toMs, pickMin, pickMax } from '../../src/baseline/utils.js'

describe('baseline/utils', () => {
  it('toMs coerces Date / ISO / number to ms and rejects garbage', () => {
    const ms = 1700000000000
    expect(toMs(ms)).toBe(ms)
    expect(toMs(new Date(ms))).toBe(ms)
    expect(toMs('2025-01-15T10:00:00.000Z')).toBe(
      Date.parse('2025-01-15T10:00:00.000Z')
    )
    expect(toMs(null)).toBeUndefined()
    expect(toMs('not-a-date')).toBeUndefined()
  })

  it('pickMin / pickMax tolerate undefined on either side', () => {
    expect(pickMin(undefined, 5)).toBe(5)
    expect(pickMin(7, 3)).toBe(3)
    expect(pickMin(undefined, undefined)).toBeUndefined()
    expect(pickMax(7, undefined)).toBe(7)
    expect(pickMax(3, 8)).toBe(8)
  })
})
