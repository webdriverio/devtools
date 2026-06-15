/**
 * Given action timestamps sorted ascending and a playback time (wall-clock ms),
 * return the timestamp of the action that is "current" — the latest one at or
 * before `time`. Returns undefined when `time` precedes the first action, so
 * nothing is highlighted before the first command runs.
 */
export function activeTimestampAt(
  sortedTimestamps: number[],
  time: number
): number | undefined {
  let active: number | undefined
  for (const ts of sortedTimestamps) {
    if (ts <= time) {
      active = ts
    } else {
      break
    }
  }
  return active
}
