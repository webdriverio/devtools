// Stable UID generation for tests and suites. The hash function is a tiny
// djb2-style char-code accumulator that produces compact base36 strings.
// "Stable" means: the same input produces the same output across runs.

/**
 * Hash arbitrary string parts into a stable, deterministic UID. Calling this
 * multiple times with the same inputs always returns the same value — no
 * counter, no hidden state. Use for entities that must map to the same UID
 * across retries (Cucumber scenarios, feature steps, etc.).
 */
export function deterministicUid(...parts: string[]): string {
  const hash = parts
    .join('::')
    .split('')
    .reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0)
  return `stable-${Math.abs(hash).toString(36)}`
}

// Counter for disambiguating repeated (file, name) signatures within a single
// test run. Cleared by resetSignatureCounters() between runs.
const signatureCounters = new Map<string, number>()

/**
 * Generate a UID from a (file, name) pair, disambiguating repeated calls with
 * the same inputs via an in-run counter. Use for test/suite identity where
 * the same file::name combo may legitimately appear multiple times in one run
 * (e.g. parameterised tests). For entities that must produce the same UID on
 * every retry (Cucumber scenarios), use {@link deterministicUid} instead.
 */
export function generateStableUid(file: string, name: string): string {
  const signature = `${file}::${name}`
  const count = signatureCounters.get(signature) ?? 0
  signatureCounters.set(signature, count + 1)
  const input = count > 0 ? `${signature}::${count}` : signature
  return deterministicUid(input)
}

/** Reset the signature counter map. Call at the start of each test run. */
export function resetSignatureCounters(): void {
  signatureCounters.clear()
}
