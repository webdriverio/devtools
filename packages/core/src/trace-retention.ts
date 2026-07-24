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
  /** Retry-stable test identity. Outcomes sharing a uid are one test's attempts
   *  (attempt 0, 1, …); an outcome with no uid is its own single-attempt group,
   *  so a flat/uid-less feed evaluates exactly as one-outcome-per-test. */
  uid?: string
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
  // Group a test's attempts so failure policies key on the RIGHT attempt: the
  // *final* attempt (retain-on-failure — a fail-then-pass ends passed) vs the
  // *first* attempt (retain-on-first-failure). A uid-less feed makes every
  // outcome its own group, so this reduces to the flat one-outcome-per-test
  // logic and is byte-identical for callers that don't supply per-attempt uids.
  const groups = groupByTest(outcomes)
  switch (policy) {
    case 'retain-on-failure':
      return { retain: groups.some((g) => finalAttempt(g).state === 'failed') }
    case 'retain-on-first-failure':
      return {
        retain: groups.some((g) => firstAttempt(g)?.state === 'failed')
      }
    case 'on-first-retry':
      return { retain: groups.some((g) => g.some((o) => o.attempt === 1)) }
    case 'on-all-retries':
      return { retain: groups.some((g) => g.some((o) => attemptOf(o) >= 1)) }
    case 'retain-on-failure-and-retries':
      return {
        retain: groups.some(
          (g) =>
            finalAttempt(g).state === 'failed' ||
            g.some((o) => attemptOf(o) >= 1)
        )
      }
  }
}

const attemptOf = (o: TestOutcome): number => o.attempt ?? 0

/** Group outcomes by `uid`; a uid-less outcome becomes its own singleton group
 *  (preserving flat, one-outcome-per-test evaluation for callers without uids). */
function groupByTest(outcomes: TestOutcome[]): TestOutcome[][] {
  const byUid = new Map<string, TestOutcome[]>()
  const groups: TestOutcome[][] = []
  for (const outcome of outcomes) {
    if (outcome.uid === undefined) {
      groups.push([outcome])
      continue
    }
    const existing = byUid.get(outcome.uid)
    if (existing) {
      existing.push(outcome)
    } else {
      const group = [outcome]
      byUid.set(outcome.uid, group)
      groups.push(group)
    }
  }
  return groups
}

/** The highest-numbered attempt's outcome — the test's final result. */
function finalAttempt(group: TestOutcome[]): TestOutcome {
  return group.reduce((best, o) => (attemptOf(o) >= attemptOf(best) ? o : best))
}

/** The attempt-0 outcome, if the group recorded one. */
function firstAttempt(group: TestOutcome[]): TestOutcome | undefined {
  return group.find((o) => attemptOf(o) === 0)
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
