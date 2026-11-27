export const STALE_SPAN_WARNING_MS = 60 * 60 * 1000
const MS_PER_MINUTE = 60_000

/** Undefined while the oldest pushed span is inside the window a backend is expected to ingest. */
export function staleSpanWarning(
  oldestEndMs: number | undefined,
  now: () => number
): string | undefined {
  if (oldestEndMs === undefined) {
    return undefined
  }
  const ageMs = now() - oldestEndMs
  if (ageMs <= STALE_SPAN_WARNING_MS) {
    return undefined
  }
  const minutes = Math.floor(ageMs / MS_PER_MINUTE)
  return `the oldest span ended ${minutes} minute(s) ago; a backend with a shorter ingestion window stores such spans without listing them in search or metrics (see README, "Timestamps")`
}
