import {
  TICK_STEPS,
  TICK_TARGET_DIVISIONS
} from './trace-timeline-constants.js'

export function tickStep(
  durationMs: number,
  targetTicks = TICK_TARGET_DIVISIONS
): number {
  const raw = durationMs / targetTicks
  return (
    TICK_STEPS.find((step) => step >= raw) ?? TICK_STEPS[TICK_STEPS.length - 1]
  )
}

/** Ruler tick label: `500ms`, `3.5s`, `1:15`. */
export function formatTickLabel(ms: number): string {
  if (ms < 1_000) {
    return `${ms}ms`
  }
  if (ms < 60_000) {
    return `${(ms / 1_000).toFixed(1)}s`
  }
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1_000)
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** `m:ss.cc` timecode (e.g. 32_270ms → `0:32.27`). */
export function formatTimecode(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0
  const totalSeconds = Math.floor(safe / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const centis = Math.floor((safe % 1000) / 10)
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${centis
    .toString()
    .padStart(2, '0')}`
}
