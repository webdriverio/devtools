import { describe, expect, it } from 'vitest'
import { STALE_SPAN_WARNING_MS, staleSpanWarning } from '../src/stale-span.js'

const NOW_MS = Date.UTC(2026, 0, 1, 12, 0, 0)

describe('staleSpanWarning', () => {
  it('stays silent when no span was pushed', () => {
    expect(staleSpanWarning(undefined, () => NOW_MS)).toBeUndefined()
  })

  it('stays silent for a span that ended within the window', () => {
    const oldest = NOW_MS - STALE_SPAN_WARNING_MS
    expect(staleSpanWarning(oldest, () => NOW_MS)).toBeUndefined()
  })

  it('names the age in whole minutes once the oldest span is past the window', () => {
    const oldest = NOW_MS - 90 * 60_000 - 30_000
    expect(staleSpanWarning(oldest, () => NOW_MS)).toBe(
      'the oldest span ended 90 minute(s) ago; a backend with a shorter ingestion window stores such spans without listing them in search or metrics (see README, "Timestamps")'
    )
  })
})
