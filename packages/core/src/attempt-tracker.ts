import type { TestStatus } from '@wdio/devtools-shared'
import type { TestOutcome } from './trace-retention.js'

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
}

export class TestAttemptTracker implements RetryOutcomeView {
  #ledger = new Map<string, { specFile?: string; attempts: TestOutcome[] }>()
  #sawRetry = false

  /** Record a starting test; returns its attempt number (0 first, +1 per rerun).
   *  `specFile` (optional) enables spec-scoped retention lookups. */
  recordStart(uid: string, specFile?: string): number {
    const entry = this.#ledger.get(uid)
    const attempt = entry ? entry.attempts.length : 0
    if (attempt > 0) {
      this.#sawRetry = true
    }
    const slot: TestOutcome = { uid, attempt }
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

  /** Stamp the resolved state onto uid's most recent attempt slot once the
   *  outcome is known. `attempt` overrides the slot's number when the adapter
   *  resolved a more authoritative value (e.g. WDIO's result.retries). */
  recordOutcome(
    uid: string,
    state: TestStatus | undefined,
    attempt?: number
  ): void {
    const attempts = this.#ledger.get(uid)?.attempts
    const slot = attempts?.[attempts.length - 1]
    if (!slot) {
      return
    }
    slot.state = state
    if (attempt !== undefined) {
      slot.attempt = attempt
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
      out.push(...entry.attempts)
    }
    return out
  }

  forSpec(specFile: string): TestOutcome[] {
    const out: TestOutcome[] = []
    for (const entry of this.#ledger.values()) {
      if (entry.specFile === specFile) {
        out.push(...entry.attempts)
      }
    }
    return out
  }

  forTest(uid: string, attempt?: number): TestOutcome[] {
    const attempts = this.#ledger.get(uid)?.attempts ?? []
    return attempt === undefined
      ? attempts
      : attempts.filter((a) => a.attempt === attempt)
  }

  /** Clear all state — used at session boundaries and reuse-mode reconnects. */
  reset(): void {
    this.#ledger.clear()
    this.#sawRetry = false
  }
}
