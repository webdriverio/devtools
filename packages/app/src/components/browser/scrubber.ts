import type { CommandLog } from '@wdio/devtools-shared'
import {
  commandCategory,
  type ActionCategory
} from '../workbench/actionItems/category.js'

/** A command pinned to a position along the screencast timeline. */
export interface ScrubMarker {
  /** Position along the track, 0–1, relative to the recording window. */
  fraction: number
  category: ActionCategory
  label: string
}

/** Format a duration in seconds as `m:ss` (e.g. 3 → `0:03`, 75 → `1:15`). */
export function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Map each command onto the recording timeline. `startTime`/`duration` are the
 * recording's first-frame timestamp and total span (ms). A command's wall-clock
 * time (`startTime`, falling back to `timestamp`) becomes a fraction 0–1; markers
 * outside the recording window are dropped so they never sit off the track.
 */
export function computeMarkers(
  commands: CommandLog[],
  startTime: number,
  duration: number
): ScrubMarker[] {
  if (!(duration > 0)) {
    return []
  }
  const markers: ScrubMarker[] = []
  for (const command of commands) {
    const ts = command.startTime ?? command.timestamp
    if (typeof ts !== 'number') {
      continue
    }
    const fraction = (ts - startTime) / duration
    if (fraction < 0 || fraction > 1) {
      continue
    }
    markers.push({
      fraction,
      category: commandCategory(command.command),
      label: command.command
    })
  }
  return markers
}
