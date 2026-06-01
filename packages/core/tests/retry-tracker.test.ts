import { describe, it, expect } from 'vitest'
import { RetryTracker } from '../src/retry-tracker.js'

describe('RetryTracker.signature', () => {
  it('produces a stable JSON shape for identical inputs', () => {
    expect(RetryTracker.signature('click', [{ id: 1 }], 'a.ts:5')).toBe(
      RetryTracker.signature('click', [{ id: 1 }], 'a.ts:5')
    )
  })

  it('changes when the command differs', () => {
    const a = RetryTracker.signature('click', [], 'a.ts:5')
    const b = RetryTracker.signature('doubleClick', [], 'a.ts:5')
    expect(a).not.toBe(b)
  })

  it('changes when the args differ', () => {
    const a = RetryTracker.signature('click', [{ x: 1 }], 'a.ts:5')
    const b = RetryTracker.signature('click', [{ x: 2 }], 'a.ts:5')
    expect(a).not.toBe(b)
  })

  it('changes when the callSource differs', () => {
    const a = RetryTracker.signature('click', [], 'a.ts:5')
    const b = RetryTracker.signature('click', [], 'a.ts:6')
    expect(a).not.toBe(b)
  })

  it('treats missing callSource the same regardless of how it was passed', () => {
    expect(RetryTracker.signature('click', [], undefined)).toBe(
      RetryTracker.signature('click', [])
    )
  })
})

describe('RetryTracker.isRetry', () => {
  it('returns false for a fresh tracker (no last capture)', () => {
    const t = new RetryTracker()
    expect(t.isRetry(RetryTracker.signature('click', []))).toBe(false)
  })

  it('returns false when only the signature was staged but no id was recorded', () => {
    const t = new RetryTracker()
    const sig = RetryTracker.signature('click', [])
    t.setLastSig(sig)
    // No lastId yet → cannot replace, not a retry.
    expect(t.isRetry(sig)).toBe(false)
  })

  it('returns true when sig matches AND an id was recorded', () => {
    const t = new RetryTracker()
    const sig = RetryTracker.signature('click', [])
    t.recordCapture(sig, 42)
    expect(t.isRetry(sig)).toBe(true)
    expect(t.lastId).toBe(42)
  })

  it('returns false when the incoming sig differs from the last capture', () => {
    const t = new RetryTracker()
    t.recordCapture(RetryTracker.signature('click', []), 1)
    expect(t.isRetry(RetryTracker.signature('doubleClick', []))).toBe(false)
  })
})

describe('RetryTracker.reset', () => {
  it('clears both the signature and the id', () => {
    const t = new RetryTracker()
    const sig = RetryTracker.signature('click', [])
    t.recordCapture(sig, 1)
    t.reset()
    expect(t.isRetry(sig)).toBe(false)
    expect(t.lastId).toBeNull()
  })
})

describe('staged-then-resolved flow (nightwatch pattern)', () => {
  it('stages sig before async capture; id arrives later; subsequent same-sig command is a retry', () => {
    const t = new RetryTracker()
    const sig = RetryTracker.signature('click', [{ x: 1 }], 'a.ts:5')

    // Pre-capture: stage the sig before kicking off the async capture.
    t.setLastSig(sig)
    t.setLastId(null)
    expect(t.isRetry(sig)).toBe(false) // id not set yet — can't replace

    // After capture completes:
    t.setLastId(7)
    expect(t.isRetry(sig)).toBe(true) // now a retry of the same call IS detected
    expect(t.lastId).toBe(7)
  })
})
