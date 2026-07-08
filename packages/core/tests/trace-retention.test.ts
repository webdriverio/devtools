import { describe, it, expect } from 'vitest'
import {
  shouldRetainTrace,
  tracePolicyModeWarning
} from '../src/trace-retention.js'
import type { TestOutcome } from '../src/trace-retention.js'
import type { TraceRetentionPolicy } from '@wdio/devtools-shared'

const allPass: TestOutcome[] = [
  { state: 'passed', attempt: 0 },
  { state: 'passed', attempt: 0 }
]
const oneFail: TestOutcome[] = [
  { state: 'passed', attempt: 0 },
  { state: 'failed', attempt: 0 }
]
const failOnRetry: TestOutcome[] = [
  { state: 'passed', attempt: 0 },
  { state: 'failed', attempt: 1 }
]
const passAfterRetry: TestOutcome[] = [
  { state: 'passed', attempt: 0 },
  { state: 'passed', attempt: 1 }
]
const secondRetryOnly: TestOutcome[] = [
  { state: 'passed', attempt: 0 },
  { state: 'passed', attempt: 2 }
]
const skippedOnly: TestOutcome[] = [{ state: 'skipped', attempt: 0 }]
const failNoAttempt: TestOutcome[] = [{ state: 'failed' }]

function retain(
  policy: TraceRetentionPolicy | undefined,
  outcomes: TestOutcome[],
  attemptInfoAvailable = true
): boolean {
  return shouldRetainTrace(policy, { outcomes, attemptInfoAvailable }).retain
}

describe('shouldRetainTrace policy matrix', () => {
  const matrix: Array<
    [TraceRetentionPolicy | undefined, TestOutcome[], string, boolean]
  > = [
    [undefined, allPass, 'all-pass', true],
    [undefined, oneFail, 'one-fail', true],
    ['on', allPass, 'all-pass', true],
    ['on', oneFail, 'one-fail', true],
    ['on', skippedOnly, 'skipped-only', true],
    ['retain-on-failure', allPass, 'all-pass', false],
    ['retain-on-failure', oneFail, 'one-fail', true],
    ['retain-on-failure', failOnRetry, 'fail-on-retry', true],
    ['retain-on-failure', passAfterRetry, 'pass-after-retry', false],
    ['retain-on-failure', skippedOnly, 'skipped-only', false],
    ['retain-on-first-failure', allPass, 'all-pass', false],
    ['retain-on-first-failure', oneFail, 'first-attempt-fail', true],
    ['retain-on-first-failure', failOnRetry, 'fail-only-on-retry', false],
    ['retain-on-first-failure', failNoAttempt, 'fail-without-attempt', true],
    ['retain-on-first-failure', passAfterRetry, 'pass-after-retry', false],
    ['on-first-retry', allPass, 'all-pass', false],
    ['on-first-retry', oneFail, 'fail-without-retry', false],
    ['on-first-retry', failOnRetry, 'fail-on-retry', true],
    ['on-first-retry', passAfterRetry, 'pass-after-retry', true],
    ['on-first-retry', secondRetryOnly, 'second-retry-only', false],
    ['on-all-retries', allPass, 'all-pass', false],
    ['on-all-retries', oneFail, 'fail-without-retry', false],
    ['on-all-retries', failOnRetry, 'fail-on-retry', true],
    ['on-all-retries', passAfterRetry, 'pass-after-retry', true],
    ['on-all-retries', secondRetryOnly, 'second-retry-only', true],
    ['retain-on-failure-and-retries', allPass, 'all-pass', false],
    ['retain-on-failure-and-retries', oneFail, 'one-fail', true],
    ['retain-on-failure-and-retries', passAfterRetry, 'retry-no-fail', true],
    ['retain-on-failure-and-retries', skippedOnly, 'skipped-only', false]
  ]

  it.each(matrix)(
    '%s + %j (%s) → retain %s',
    (policy, outcomes, _label, expected) => {
      expect(retain(policy, outcomes)).toBe(expected)
    }
  )

  it('sets no flags on a plain decision', () => {
    expect(
      shouldRetainTrace('retain-on-failure', {
        outcomes: oneFail,
        attemptInfoAvailable: true
      })
    ).toEqual({ retain: true })
  })

  it('accepts any iterable of outcomes', () => {
    function* gen(): Generator<TestOutcome> {
      yield { state: 'failed', attempt: 0 }
    }
    expect(
      shouldRetainTrace('retain-on-failure', {
        outcomes: gen(),
        attemptInfoAvailable: true
      }).retain
    ).toBe(true)
  })
})

describe('shouldRetainTrace empty outcomes (fail-open)', () => {
  const conditionalPolicies: TraceRetentionPolicy[] = [
    'retain-on-failure',
    'retain-on-first-failure',
    'on-first-retry',
    'on-all-retries',
    'retain-on-failure-and-retries'
  ]

  it.each(conditionalPolicies)('%s retains with failOpen', (policy) => {
    expect(
      shouldRetainTrace(policy, { outcomes: [], attemptInfoAvailable: true })
    ).toEqual({ retain: true, failOpen: true })
  })

  it('fail-open wins over degradation when attempt info is also missing', () => {
    expect(
      shouldRetainTrace('on-first-retry', {
        outcomes: [],
        attemptInfoAvailable: false
      })
    ).toEqual({ retain: true, failOpen: true })
  })

  it('undefined and "on" retain without the failOpen flag', () => {
    expect(
      shouldRetainTrace(undefined, { outcomes: [], attemptInfoAvailable: true })
    ).toEqual({ retain: true })
    expect(
      shouldRetainTrace('on', { outcomes: [], attemptInfoAvailable: true })
    ).toEqual({ retain: true })
  })
})

describe('shouldRetainTrace degradation without attempt info', () => {
  const retryPolicies: TraceRetentionPolicy[] = [
    'retain-on-first-failure',
    'on-first-retry',
    'on-all-retries',
    'retain-on-failure-and-retries'
  ]

  it.each(retryPolicies)('%s degrades to retain-on-failure', (policy) => {
    expect(
      shouldRetainTrace(policy, {
        outcomes: oneFail,
        attemptInfoAvailable: false
      })
    ).toEqual({ retain: true, degradedToFailure: true })
    expect(
      shouldRetainTrace(policy, {
        outcomes: allPass,
        attemptInfoAvailable: false
      })
    ).toEqual({ retain: false, degradedToFailure: true })
  })

  it.each(retryPolicies)(
    '%s ignores untrustworthy attempt values when degraded',
    (policy) => {
      expect(
        shouldRetainTrace(policy, {
          outcomes: passAfterRetry,
          attemptInfoAvailable: false
        })
      ).toEqual({ retain: false, degradedToFailure: true })
    }
  )

  it('retain-on-failure never degrades — it needs no attempt info', () => {
    expect(
      shouldRetainTrace('retain-on-failure', {
        outcomes: oneFail,
        attemptInfoAvailable: false
      })
    ).toEqual({ retain: true })
  })

  it('"on" and undefined never degrade', () => {
    expect(
      shouldRetainTrace('on', {
        outcomes: allPass,
        attemptInfoAvailable: false
      })
    ).toEqual({ retain: true })
    expect(
      shouldRetainTrace(undefined, {
        outcomes: allPass,
        attemptInfoAvailable: false
      })
    ).toEqual({ retain: true })
  })
})

describe('shouldRetainTrace unknown policy (fail open)', () => {
  // A JS config can pass a string TS never validated. It must retain (treated
  // as `on`) rather than silently drop traces the user might need.
  const unknown = 'retain-on-tuesdays' as TraceRetentionPolicy

  it('retains all-passing outcomes', () => {
    expect(retain(unknown, allPass)).toBe(true)
    expect(retain(unknown, allPass, false)).toBe(true)
  })

  it('retains failing outcomes', () => {
    expect(retain(unknown, oneFail)).toBe(true)
  })

  it('retains with no outcomes', () => {
    expect(
      shouldRetainTrace(unknown, { outcomes: [], attemptInfoAvailable: false })
    ).toEqual({ retain: true })
  })
})

describe('tracePolicyModeWarning', () => {
  it('warns when a policy is set outside trace mode', () => {
    expect(tracePolicyModeWarning('retain-on-failure', 'live')).toMatch(
      /trace mode/
    )
    expect(tracePolicyModeWarning('retain-on-failure', undefined)).toMatch(
      /trace mode/
    )
  })

  it('stays silent in trace mode or when no policy is set', () => {
    expect(tracePolicyModeWarning('retain-on-failure', 'trace')).toBeUndefined()
    expect(tracePolicyModeWarning(undefined, 'live')).toBeUndefined()
  })
})
