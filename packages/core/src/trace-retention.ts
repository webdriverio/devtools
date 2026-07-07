import type { TestStatus, TraceRetentionPolicy } from '@wdio/devtools-shared'

/**
 * Pure retention policy evaluation for trace mode. Adapters collect the
 * observed test outcomes for a trace scope (session/spec/test) and ask
 * whether the written trace should be kept.
 */

export interface TestOutcome {
  state?: TestStatus
  attempt?: number
}

export interface RetentionInput {
  outcomes: Iterable<TestOutcome>
  /** Whether the adapter can distinguish retries (per-outcome `attempt`). */
  attemptInfoAvailable: boolean
}

export interface RetentionDecision {
  retain: boolean
  /** Set when a retry-aware policy fell back to `retain-on-failure` because attempt info was unavailable. */
  degradedToFailure?: boolean
  /** Set when no outcomes were observed (standalone scripts) — retained rather than risk losing a needed trace. */
  failOpen?: boolean
}

export function shouldRetainTrace(
  policy: TraceRetentionPolicy | undefined,
  input: RetentionInput
): RetentionDecision {
  if (policy === undefined || policy === 'on') {
    return { retain: true }
  }
  const outcomes = Array.from(input.outcomes)
  if (outcomes.length === 0) {
    return { retain: true, failOpen: true }
  }
  const anyFailed = outcomes.some((o) => o.state === 'failed')
  if (!input.attemptInfoAvailable && policy !== 'retain-on-failure') {
    return { retain: anyFailed, degradedToFailure: true }
  }
  switch (policy) {
    case 'retain-on-failure':
      return { retain: anyFailed }
    case 'retain-on-first-failure':
      return {
        retain: outcomes.some(
          (o) => o.state === 'failed' && (o.attempt ?? 0) === 0
        )
      }
    case 'on-first-retry':
      return { retain: outcomes.some((o) => o.attempt === 1) }
    case 'on-all-retries':
      return { retain: outcomes.some((o) => (o.attempt ?? 0) >= 1) }
    case 'retain-on-failure-and-retries':
      return {
        retain: anyFailed || outcomes.some((o) => (o.attempt ?? 0) >= 1)
      }
  }
}
