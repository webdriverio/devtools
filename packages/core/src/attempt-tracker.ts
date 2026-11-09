import type { TestAttemptRecord, TestStatus } from '@wdio/devtools-shared'
import type { TestOutcome } from '@wdio/devtools-trace/trace-retention'
import {
  mintTraceContext,
  resolveParentTraceContext,
  type AttemptIds
} from './trace-context.js'

interface AttemptSlot {
  outcome: TestOutcome
  startTime: number
  endTime?: number
  trace: AttemptIds
}

/**
 * Framework-agnostic per-test attempt ledger. Every supported runner re-enters
 * its per-test start hook when a test is retried, so recording the same uid
 * again appends a new attempt slot (0-based: first run is attempt 0, first retry
 * is attempt 1). Once the outcome is known the adapter stamps it onto the slot.
 * This is the primary, runner-independent retry signal feeding the retry-aware
 * trace policies — the finalizer reads the scoped views to evaluate retention
 * per test/spec/session with real per-attempt outcomes (see trace-retention.ts).
 */
export interface RetryOutcomeView {
  /** Every attempt of every test — for session-scope retention. */
  all(): TestOutcome[]
  /** Every attempt of the tests recorded against `specFile` — for spec scope. */
  forSpec(specFile: string): TestOutcome[]
  /** A single test's attempts; pass `attempt` to scope to one attempt's slice. */
  forTest(uid: string, attempt?: number): TestOutcome[]
  /** Every attempt of `uid` with its timing and trace context, for the manifest. */
  attemptsFor(uid: string): TestAttemptRecord[]
}

export class TestAttemptTracker implements RetryOutcomeView {
  #ledger = new Map<string, { specFile?: string; attempts: AttemptSlot[] }>()
  #sawRetry = false

  /** Record a starting test; returns its attempt number (0 first, +1 per rerun).
   *  `specFile` (optional) enables spec-scoped retention lookups. */
  recordStart(uid: string, specFile?: string): number {
    const entry = this.#ledger.get(uid)
    if (entry && entry.attempts.length > 0) {
      this.#sawRetry = true
      // A retry only follows a failure. Some runners (e.g. Mocha through a
      // --require plugin) can't observe the failed attempt's state from their
      // outcome hook and report it as passed — the retry starting IS the
      // reliable failure signal, so stamp the prior attempt failed here.
      const prior = entry.attempts[entry.attempts.length - 1]!
      prior.outcome.state = 'failed'
      prior.endTime ??= Date.now()
    }
    const attempt = entry ? entry.attempts.length : 0
    const slot: AttemptSlot = {
      outcome: { uid, attempt },
      startTime: Date.now(),
      trace: mintTraceContext(resolveParentTraceContext())
    }
    if (entry) {
      entry.attempts.push(slot)
      if (specFile !== undefined) {
        entry.specFile = specFile
      }
    } else {
      this.#ledger.set(uid, { specFile, attempts: [slot] })
    }
    return attempt
  }

  /** Stamp the resolved state onto uid's most recent attempt slot once the outcome is known. A runner attempt
   *  past the ledger's count (in-worker repeat) renumbers the slot to it, so the record matches the test's attempt. */
  recordOutcome(
    uid: string,
    state: TestStatus | undefined,
    attempt?: number
  ): void {
    const attempts = this.#ledger.get(uid)?.attempts ?? []
    const slot = attempts[attempts.length - 1]
    if (!slot) {
      return
    }
    slot.outcome.state = state
    slot.endTime = Date.now()
    if (attempt !== undefined && attempt >= attempts.length) {
      slot.outcome.attempt = attempt
    }
  }

  /** Latest attempt recorded for `uid`, or undefined if it never started. */
  attemptFor(uid: string): number | undefined {
    const entry = this.#ledger.get(uid)
    return entry ? entry.attempts.length - 1 : undefined
  }

  /** True once any test has started more than once (a retry occurred). */
  get sawRetry(): boolean {
    return this.#sawRetry
  }

  all(): TestOutcome[] {
    const out: TestOutcome[] = []
    for (const entry of this.#ledger.values()) {
      out.push(...entry.attempts.map((slot) => slot.outcome))
    }
    return out
  }

  forSpec(specFile: string): TestOutcome[] {
    const out: TestOutcome[] = []
    for (const entry of this.#ledger.values()) {
      if (entry.specFile === specFile) {
        out.push(...entry.attempts.map((slot) => slot.outcome))
      }
    }
    return out
  }

  forTest(uid: string, attempt?: number): TestOutcome[] {
    const outcomes = (this.#ledger.get(uid)?.attempts ?? []).map(
      (slot) => slot.outcome
    )
    return attempt === undefined
      ? outcomes
      : outcomes.filter((o) => o.attempt === attempt)
  }

  attemptsFor(uid: string): TestAttemptRecord[] {
    return (this.#ledger.get(uid)?.attempts ?? []).map((slot) => ({
      attempt: slot.outcome.attempt ?? 0,
      state: slot.outcome.state,
      startTime: slot.startTime,
      endTime: slot.endTime,
      traceId: slot.trace.traceId,
      spanId: slot.trace.spanId
    }))
  }

  /** Clear all state — used at session boundaries and reuse-mode reconnects. */
  reset(): void {
    this.#ledger.clear()
    this.#sawRetry = false
  }
}
