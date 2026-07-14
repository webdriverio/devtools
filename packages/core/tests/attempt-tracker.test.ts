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

  describe('outcome ledger', () => {
    it('records per-attempt outcomes with uid + attempt for a retried test', () => {
      const t = new TestAttemptTracker()
      t.recordStart('a', 'login.spec.ts')
      t.recordOutcome('a', 'failed')
      t.recordStart('a', 'login.spec.ts')
      t.recordOutcome('a', 'passed')
      expect(t.forTest('a')).toEqual([
        { uid: 'a', attempt: 0, state: 'failed' },
        { uid: 'a', attempt: 1, state: 'passed' }
      ])
    })

    it('recordOutcome stamps only the latest attempt slot', () => {
      const t = new TestAttemptTracker()
      t.recordStart('a')
      t.recordOutcome('a', 'passed')
      t.recordStart('a')
      t.recordOutcome('a', 'failed')
      expect(t.forTest('a').map((o) => o.state)).toEqual(['passed', 'failed'])
    })

    it('recordOutcome can override the slot attempt (authoritative retry #)', () => {
      const t = new TestAttemptTracker()
      t.recordStart('a')
      t.recordOutcome('a', 'failed', 3)
      expect(t.forTest('a')).toEqual([
        { uid: 'a', attempt: 3, state: 'failed' }
      ])
    })

    it('forTest(uid, attempt) scopes to one attempt (per-slice retention)', () => {
      const t = new TestAttemptTracker()
      t.recordStart('a')
      t.recordOutcome('a', 'failed')
      t.recordStart('a')
      t.recordOutcome('a', 'passed')
      expect(t.forTest('a', 0)).toEqual([
        { uid: 'a', attempt: 0, state: 'failed' }
      ])
      expect(t.forTest('a', 1)).toEqual([
        { uid: 'a', attempt: 1, state: 'passed' }
      ])
    })

    it('all() and forSpec() gather attempts across tests', () => {
      const t = new TestAttemptTracker()
      t.recordStart('a', 'one.spec.ts')
      t.recordOutcome('a', 'failed')
      t.recordStart('a', 'one.spec.ts')
      t.recordOutcome('a', 'passed')
      t.recordStart('b', 'two.spec.ts')
      t.recordOutcome('b', 'passed')
      expect(t.all()).toHaveLength(3)
      expect(t.forSpec('one.spec.ts').map((o) => o.uid)).toEqual(['a', 'a'])
      expect(t.forSpec('two.spec.ts')).toEqual([
        { uid: 'b', attempt: 0, state: 'passed' }
      ])
    })

    it('recordOutcome is a safe no-op for an unstarted uid', () => {
      const t = new TestAttemptTracker()
      expect(() => t.recordOutcome('ghost', 'failed')).not.toThrow()
      expect(t.forTest('ghost')).toEqual([])
    })

    it('reset clears the ledger too', () => {
      const t = new TestAttemptTracker()
      t.recordStart('a')
      t.recordOutcome('a', 'failed')
      t.reset()
      expect(t.all()).toEqual([])
    })
  })
})
