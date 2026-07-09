import { describe, it, expect } from 'vitest'
import { TestAttemptTracker } from '../src/attempt-tracker.js'

describe('TestAttemptTracker', () => {
  it('numbers the first start 0 and each rerun +1', () => {
    const t = new TestAttemptTracker()
    expect(t.recordStart('a')).toBe(0)
    expect(t.recordStart('a')).toBe(1)
    expect(t.recordStart('a')).toBe(2)
  })

  it('tracks attempts per uid independently', () => {
    const t = new TestAttemptTracker()
    expect(t.recordStart('a')).toBe(0)
    expect(t.recordStart('b')).toBe(0)
    expect(t.recordStart('a')).toBe(1)
    expect(t.attemptFor('a')).toBe(1)
    expect(t.attemptFor('b')).toBe(0)
  })

  it('attemptFor is undefined for an unseen uid', () => {
    const t = new TestAttemptTracker()
    expect(t.attemptFor('missing')).toBeUndefined()
  })

  it('sawRetry flips only after a second start of some test', () => {
    const t = new TestAttemptTracker()
    expect(t.sawRetry).toBe(false)
    t.recordStart('a')
    t.recordStart('b')
    expect(t.sawRetry).toBe(false)
    t.recordStart('a')
    expect(t.sawRetry).toBe(true)
  })

  it('reset clears attempts and the retry flag', () => {
    const t = new TestAttemptTracker()
    t.recordStart('a')
    t.recordStart('a')
    expect(t.sawRetry).toBe(true)
    t.reset()
    expect(t.sawRetry).toBe(false)
    expect(t.attemptFor('a')).toBeUndefined()
    expect(t.recordStart('a')).toBe(0)
  })
})
