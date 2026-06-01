/**
 * Tiny state holder for command-retry detection. Both the selenium and
 * nightwatch adapters need exactly this same pattern: compute a stable
 * signature for the incoming command, compare it to the last one we
 * captured, and treat a match as "the framework is retrying — replace the
 * previous entry instead of pushing a new one".
 *
 * The signature is JSON-stringified `{command, args, src: callSource}`. Test
 * boundaries (new test, new scenario) call `reset()` to drop the last
 * signature so a deliberate re-run of the same call counts as a fresh
 * command, not a retry.
 */
export class RetryTracker {
  #lastSig: string | null = null
  #lastId: number | null = null

  /** Build the canonical signature used for retry-equality checks. */
  static signature(command: string, args: unknown, callSource?: string): string {
    return JSON.stringify({ command, args, src: callSource ?? null })
  }

  /** True when the incoming signature matches the last captured one AND we
   *  have an id to replace (otherwise there's nothing to replace yet). */
  isRetry(sig: string): boolean {
    return sig === this.#lastSig && this.#lastId !== null
  }

  /** The id of the last captured command, if any (for the replace-in-place
   *  flow). */
  get lastId(): number | null {
    return this.#lastId
  }

  /** Record a fresh capture — sets both sig and id together. */
  recordCapture(sig: string, id: number | null): void {
    this.#lastSig = sig
    this.#lastId = id
  }

  /** Record only the id (used by adapters that compute the sig but defer the
   *  id assignment to after an async capture call). */
  setLastId(id: number | null): void {
    this.#lastId = id
  }

  /** Stage the sig before an async capture so the next call already sees the
   *  signature change (prevents stale-sig matches on rapid back-to-back
   *  commands). Pair with {@link setLastId} once the capture resolves. */
  setLastSig(sig: string): void {
    this.#lastSig = sig
  }

  /** Reset at test/scenario boundaries so the next capture is "fresh". */
  reset(): void {
    this.#lastSig = null
    this.#lastId = null
  }
}
