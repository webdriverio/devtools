import type {
  DevToolsMode,
  TestStatus,
  TraceRetentionPolicy
} from '@wdio/devtools-shared'

/**
 * Pure retention policy evaluation for trace mode. Adapters collect the
 * observed test outcomes for a trace scope (session/spec/test) and ask
 * whether the written trace should be kept.
 */

/** Every policy the evaluator recognizes. An unknown string (from a JS config
 *  that slipped past the type) is treated as `on` — fail open, never silently
 *  drop a trace the user might need. */
const KNOWN_POLICIES = new Set<TraceRetentionPolicy>([
  'on',
  'retain-on-failure',
  'retain-on-first-failure',
  'on-first-retry',
  'on-all-retries',
  'retain-on-failure-and-retries'
])

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
  if (policy === undefined || policy === 'on' || !KNOWN_POLICIES.has(policy)) {
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

/**
 * Warning text when a retention policy is configured outside trace mode, where
 * it has no effect (the finalizer no-ops in live mode). Returns undefined when
 * there is nothing to warn about, so each adapter can `if (msg) log.warn(msg)`.
 */
export function tracePolicyModeWarning(
  policy: TraceRetentionPolicy | undefined,
  mode: DevToolsMode | undefined
): string | undefined {
  if (policy === undefined || mode === 'trace') {
    return undefined
  }
  return 'tracePolicy only applies in trace mode; ignoring it because mode is not "trace".'
}
