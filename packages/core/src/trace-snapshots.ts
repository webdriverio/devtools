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

export function buildSnapshotResources(
  snapshots: ActionSnapshot[],
  pageId: string
): TraceZipResource[] {
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

/**
 * Full filmstrip for the trace: the first snapshot is re-anchored to t=0 so
 * viewers show the page state before any interaction; the rest keep their
 * wall-time offsets.
 */
export function buildFilmstripEvents(
  snapshots: ActionSnapshot[],
  pageId: string,
  wallTime: number,
  viewport: { width: number; height: number }
): ScreencastFrameEvent[] {
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
