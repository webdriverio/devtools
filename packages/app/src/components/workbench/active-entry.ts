/** Timeline item occupying a span from `startTime` (inclusive) to `timestamp`
 *  (inclusive). Items without a `startTime` occupy the single point `timestamp`. */
export interface TimeSpanned {
  timestamp: number
  startTime?: number
}

/**
 * Given timeline items and a playback time (wall-clock ms), return the item
 * that is "current" at `time`. An item's span is `[startTime ?? timestamp,
 * timestamp]` and the item is current when `time` falls inside it — so a
 * long-running command (e.g. a polling `expect.*` matcher) stays selected for
 * its whole duration, not just at completion. When several spans contain `time`
 * (nested/overlapping commands), the one that started most recently wins, with
 * ties broken toward the tighter span — the most specific action in progress.
 * When none contain `time` (a point-like command, or a gap between actions),
 * fall back to the latest item that has already ended at or before `time`.
 * Returns undefined when `time` precedes every item, so nothing is highlighted
 * before the first action runs.
 */
export function activeSpanAt<T extends TimeSpanned>(
  items: readonly T[],
  time: number
): T | undefined {
  let containing: T | undefined
  let containingStart = -Infinity
  let containingEnd = Infinity
  let ended: T | undefined
  let endedAt = -Infinity

  for (const item of items) {
    const end = item.timestamp
    const start = item.startTime ?? end
    if (
      start <= time &&
      time <= end &&
      (start > containingStart ||
        (start === containingStart && end < containingEnd))
    ) {
      containing = item
      containingStart = start
      containingEnd = end
    }
    if (end <= time && end >= endedAt) {
      ended = item
      endedAt = end
    }
  }

  return containing ?? ended
}
