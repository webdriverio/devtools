/**
 * Framework-agnostic per-test attempt counting. Every supported runner
 * re-enters its per-test start hook when a test is retried, so recording the
 * same uid again yields an incremented attempt number (0-based: the first run
 * is attempt 0, the first retry is attempt 1). This is the primary,
 * runner-independent retry signal feeding `TestOutcome.attempt` for the
 * retry-aware trace policies (see trace-retention.ts).
 */
export class TestAttemptTracker {
  #attempts = new Map<string, number>()
  #sawRetry = false

  /** Record a starting test; returns its attempt number (0 first, +1 per rerun). */
  recordStart(uid: string): number {
    const prior = this.#attempts.get(uid)
    const attempt = prior === undefined ? 0 : prior + 1
    this.#attempts.set(uid, attempt)
    if (attempt > 0) {
      this.#sawRetry = true
    }
    return attempt
  }

  /** Latest attempt recorded for `uid`, or undefined if it never started. */
  attemptFor(uid: string): number | undefined {
    return this.#attempts.get(uid)
  }

  /** True once any test has started more than once (a retry occurred). */
  get sawRetry(): boolean {
    return this.#sawRetry
  }

  /** Clear all state — used at session boundaries and reuse-mode reconnects. */
  reset(): void {
    this.#attempts.clear()
    this.#sawRetry = false
  }
}
