import { describe, it, expect } from 'vitest'
import {
  formatTickLabel,
  tickStep
} from '../src/components/browser/trace-timeline-utils.js'

describe('tickStep', () => {
  it('picks the smallest step yielding at most the target tick count', () => {
    expect(tickStep(10_000)).toBe(1_000)
    expect(tickStep(78_460)).toBe(10_000)
    expect(tickStep(1_200)).toBe(100)
  })

  it('caps at the largest step for very long traces', () => {
    expect(tickStep(3 * 60 * 60 * 1000)).toBe(600_000)
  })
})

describe('formatTickLabel', () => {
  it('formats sub-second ticks as milliseconds', () => {
    expect(formatTickLabel(500)).toBe('500ms')
  })

  it('formats seconds with one decimal', () => {
    expect(formatTickLabel(1_000)).toBe('1.0s')
    expect(formatTickLabel(3_500)).toBe('3.5s')
  })

  it('formats minutes as m:ss', () => {
    expect(formatTickLabel(75_000)).toBe('1:15')
    expect(formatTickLabel(60_000)).toBe('1:00')
  })
})
