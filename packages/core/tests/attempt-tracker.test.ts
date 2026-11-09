import { afterEach, describe, it, expect, vi } from 'vitest'
import { TestAttemptTracker } from '../src/attempt-tracker.js'

const HEX_32 = /^[0-9a-f]{32}$/
const HEX_16 = /^[0-9a-f]{16}$/
const PARENT_TRACE_ID = '0af7651916cd43dd8448eb211c80319c'
const PARENT_SPAN_ID = 'b7ad6b7169203331'

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

    it('recordOutcome stamps the latest slot', () => {
      const t = new TestAttemptTracker()
      t.recordStart('a')
      t.recordOutcome('a', 'passed')
      expect(t.forTest('a')).toEqual([
        { uid: 'a', attempt: 0, state: 'passed' }
      ])
    })

    it('recordOutcome renumbers the slot to a runner attempt past the ledger count', () => {
      const t = new TestAttemptTracker()
      t.recordStart('a')
      t.recordOutcome('a', 'passed', 3)
      expect(t.attemptsFor('a').map((r) => r.attempt)).toEqual([3])
    })

    it('recordOutcome keeps the ledger number when the runner attempt is not ahead', () => {
      const t = new TestAttemptTracker()
      t.recordStart('a')
      t.recordStart('a')
      t.recordOutcome('a', 'passed', 0)
      expect(t.attemptsFor('a').map((r) => r.attempt)).toEqual([0, 1])
    })

    it('a retry stamps the prior attempt failed (swallowed-failure runners)', () => {
      // Mocha via a --require plugin reports the retried attempt as passed; the
      // retry starting is the reliable failure signal, so attempt 0 is corrected.
      const t = new TestAttemptTracker()
      t.recordStart('a')
      t.recordOutcome('a', 'passed') // outcome hook couldn't see the failure
      t.recordStart('a') // retry ⟹ attempt 0 must have failed
      t.recordOutcome('a', 'passed') // attempt 1 genuinely passed
      expect(t.forTest('a')).toEqual([
        { uid: 'a', attempt: 0, state: 'failed' },
        { uid: 'a', attempt: 1, state: 'passed' }
      ])
    })

    it('numbers attempts 0, 1, 2 in start order, the numbers their slices are keyed by', () => {
      const t = new TestAttemptTracker()
      for (const state of ['failed', 'failed', 'passed'] as const) {
        t.recordStart('a')
        t.recordOutcome('a', state)
      }
      expect(t.attemptsFor('a').map((record) => record.attempt)).toEqual([
        0, 1, 2
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
  describe('attempt records', () => {
    afterEach(() => {
      vi.useRealTimers()
      vi.unstubAllEnvs()
      vi.resetModules()
    })

    it('stamps start and end times and mints hex trace context per attempt', () => {
      vi.useFakeTimers()
      vi.setSystemTime(1000)
      const t = new TestAttemptTracker()
      t.recordStart('a')
      vi.setSystemTime(1500)
      t.recordOutcome('a', 'failed')
      vi.setSystemTime(2000)
      t.recordStart('a')
      t.recordOutcome('a', 'passed')
      const [first, second] = t.attemptsFor('a')
      expect(first).toMatchObject({
        attempt: 0,
        state: 'failed',
        startTime: 1000,
        endTime: 1500
      })
      expect(second).toMatchObject({
        attempt: 1,
        state: 'passed',
        startTime: 2000,
        endTime: 2000
      })
      expect(first!.traceId).toMatch(HEX_32)
      expect(first!.spanId).toMatch(HEX_16)
    })

    it('gives each attempt its own span, and its own trace when no parent is set', async () => {
      vi.stubEnv('TRACEPARENT', '')
      vi.resetModules()
      const { TestAttemptTracker: Tracker } =
        await import('../src/attempt-tracker.js')
      const t = new Tracker()
      t.recordStart('a')
      t.recordStart('a')
      const [first, second] = t.attemptsFor('a')
      expect(first!.spanId).not.toBe(second!.spanId)
      expect(first!.traceId).not.toBe(second!.traceId)
    })

    it('joins the parent trace when TRACEPARENT is set', async () => {
      vi.stubEnv('TRACEPARENT', `00-${PARENT_TRACE_ID}-${PARENT_SPAN_ID}-01`)
      vi.resetModules()
      const { TestAttemptTracker: Tracker } =
        await import('../src/attempt-tracker.js')
      const t = new Tracker()
      t.recordStart('a')
      t.recordStart('a')
      t.recordStart('b')
      const traceIds = t.attemptsFor('a').map((r) => r.traceId)
      expect(traceIds).toEqual([PARENT_TRACE_ID, PARENT_TRACE_ID])
      expect(t.attemptsFor('b')[0]!.traceId).toBe(PARENT_TRACE_ID)
      expect(t.attemptsFor('a')[0]!.spanId).not.toBe(PARENT_SPAN_ID)
    })

    it('attemptsFor is empty for an unseen uid', () => {
      expect(new TestAttemptTracker().attemptsFor('ghost')).toEqual([])
    })

    it('keeps the outcome views shaped as before', () => {
      const t = new TestAttemptTracker()
      t.recordStart('a')
      t.recordOutcome('a', 'passed')
      expect(t.forTest('a')).toEqual([
        { uid: 'a', attempt: 0, state: 'passed' }
      ])
      expect(Object.keys(t.forTest('a')[0]!).sort()).toEqual([
        'attempt',
        'state',
        'uid'
      ])
    })
  })
})
