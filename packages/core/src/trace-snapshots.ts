// Per-action snapshot resources and the screencast-frame filmstrip derived
// from them. Split from trace-exporter.ts; the exporter composes these into
// the trace event stream.

import type { ActionSnapshot } from '@wdio/devtools-shared'
import type { TraceZipResource } from './trace-zip-writer.js'

export interface ScreencastFrameEvent {
  type: 'screencast-frame'
  pageId: string
  sha1: string
  elements?: string
  snapshot?: string
  width: number
  height: number
  timestamp: number
}

// Two snapshots at the same timestamp (a real post-action capture and a blank
// end-of-scenario one) map to the same `${pageId}-${ts}` resource name, so a
// last-wins write lets a blank frame clobber the real one — and the real
// screenshot and real elements can land on different captures. Collapse to one
// per timestamp: largest screenshot, richest metadata, merged across duplicates.
function collapseByTimestamp(snapshots: ActionSnapshot[]): ActionSnapshot[] {
  const byTs = new Map<number, ActionSnapshot>()
  const order: number[] = []
  for (const snap of snapshots) {
    const existing = byTs.get(snap.timestamp)
    if (!existing) {
      byTs.set(snap.timestamp, { ...snap })
      order.push(snap.timestamp)
      continue
    }
    if ((snap.screenshot?.length ?? 0) > (existing.screenshot?.length ?? 0)) {
      existing.screenshot = snap.screenshot
    }
    if (!existing.elements?.length && snap.elements?.length) {
      existing.elements = snap.elements
    }
    if (!existing.snapshotText && snap.snapshotText) {
      existing.snapshotText = snap.snapshotText
    }
  }
  return order.map((ts) => byTs.get(ts)!)
}

export function buildSnapshotResources(
  rawSnapshots: ActionSnapshot[],
  pageId: string
): TraceZipResource[] {
  const snapshots = collapseByTimestamp(rawSnapshots)
  const out: TraceZipResource[] = []
  for (const snap of snapshots) {
    const base = `${pageId}-${snap.timestamp}`
    if (snap.screenshot) {
      out.push({
        resourceName: `${base}.jpeg`,
        data: Buffer.from(snap.screenshot, 'base64')
      })
    }
    if (snap.elements && snap.elements.length) {
      out.push({
        resourceName: `${base}-elements.json`,
        data: Buffer.from(JSON.stringify(snap.elements), 'utf8')
      })
    }
    if (snap.snapshotText) {
      out.push({
        resourceName: `${base}-snapshot.txt`,
        data: Buffer.from(snap.snapshotText, 'utf8')
      })
    }
  }
  return out
}

function frameForSnapshot(
  snap: ActionSnapshot,
  pageId: string,
  timestamp: number,
  viewport: { width: number; height: number }
): ScreencastFrameEvent {
  const base = `${pageId}-${snap.timestamp}`
  const frame: ScreencastFrameEvent = {
    type: 'screencast-frame',
    pageId,
    sha1: `${base}.jpeg`,
    width: viewport.width,
    height: viewport.height,
    timestamp
  }
  if (snap.elements && snap.elements.length) {
    frame.elements = `${base}-elements.json`
  }
  if (snap.snapshotText) {
    frame.snapshot = `${base}-snapshot.txt`
  }
  return frame
}

/** Filmstrip events; the first snapshot is re-anchored to t=0 for pre-interaction state. */
export function buildFilmstripEvents(
  rawSnapshots: ActionSnapshot[],
  pageId: string,
  wallTime: number,
  viewport: { width: number; height: number }
): ScreencastFrameEvent[] {
  const snapshots = collapseByTimestamp(rawSnapshots)
  const firstSnap = snapshots.find((s) => s.screenshot)
  const events: ScreencastFrameEvent[] = []
  if (firstSnap) {
    events.push(frameForSnapshot(firstSnap, pageId, 0, viewport))
  }
  for (const snap of snapshots) {
    if (snap === firstSnap || !snap.screenshot) {
      continue
    }
    events.push(
      frameForSnapshot(
        snap,
        pageId,
        Math.max(0, snap.timestamp - wallTime),
        viewport
      )
    )
  }
  return events
}
