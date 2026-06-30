import type { ActionSnapshot } from '@wdio/devtools-shared'

/** Collapse snapshots sharing a timestamp to the one with the largest
 *  screenshot. The trace writer names resources by timestamp, so same-timestamp
 *  snapshots collide; keeping the richest preserves a navigated action's result
 *  over a blank mid-navigation frame. */
export function dedupeSnapshotsByTimestamp(
  snapshots: ActionSnapshot[]
): ActionSnapshot[] {
  const best = new Map<number, ActionSnapshot>()
  for (const snap of snapshots) {
    const current = best.get(snap.timestamp)
    if (
      !current ||
      (snap.screenshot?.length ?? 0) > (current.screenshot?.length ?? 0)
    ) {
      best.set(snap.timestamp, snap)
    }
  }
  return [...best.values()].sort((a, b) => a.timestamp - b.timestamp)
}
