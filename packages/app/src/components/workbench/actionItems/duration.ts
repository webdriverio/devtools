export type DurationHeat = 'fast' | 'mid' | 'slow'

const ONE_SECOND = 1000
const ONE_MINUTE = ONE_SECOND * 60

/** Human-readable duration: `ms` under a second, `s` under a minute, `m s`
 *  above. Rounds first — reconstructed traces carry fractional-ms clocks. */
export function formatDuration(ms: number): string {
  const rounded = Math.round(ms)
  if (rounded > ONE_MINUTE) {
    const minutes = Math.floor(rounded / ONE_MINUTE)
    const seconds = Math.floor((rounded - minutes * ONE_MINUTE) / ONE_SECOND)
    return `${minutes}m ${seconds}s`
  }
  if (rounded > ONE_SECOND) {
    return `${(rounded / ONE_SECOND).toFixed(2)}s`
  }
  return `${rounded}ms`
}

/** Bucket a step duration so slow steps stand out: fast < 500ms ≤ mid < 2s ≤ slow. */
export function durationHeat(ms: number): DurationHeat {
  if (ms >= 2000) {
    return 'slow'
  }
  if (ms >= 500) {
    return 'mid'
  }
  return 'fast'
}

/**
 * Per-step duration for each timeline entry: the gap to the next entry. The
 * final entry has no next, so it falls back to the gap from the previous entry
 * — that way every row shows a duration. A lone entry has no neighbour at all.
 */
export function stepDurations(timestamps: number[]): Array<number | undefined> {
  return timestamps.map((ts, index) => {
    const next = timestamps[index + 1]
    if (next !== undefined) {
      return next - ts
    }
    const prev = timestamps[index - 1]
    return prev !== undefined ? ts - prev : undefined
  })
}
