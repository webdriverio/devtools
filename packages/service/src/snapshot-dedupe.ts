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

/** Insert a snapshot, or — when one already shares its timestamp — keep only
 *  the richer screenshot, replacing in place to preserve any index ranges into
 *  the list. Applies the dedupe heuristic at capture time so a blank
 *  end-of-scenario frame can't clobber the last action's real result on export
 *  paths that don't run dedupeSnapshotsByTimestamp (e.g. per-spec traces). */
export function upsertRichestSnapshot(
  snapshots: ActionSnapshot[],
  snap: ActionSnapshot
): void {
  const idx = snapshots.findIndex((s) => s.timestamp === snap.timestamp)
  if (idx === -1) {
    snapshots.push(snap)
    return
  }
  const existing = snapshots[idx]!
  if ((snap.screenshot?.length ?? 0) > (existing.screenshot?.length ?? 0)) {
    snapshots[idx] = snap
  }
}
