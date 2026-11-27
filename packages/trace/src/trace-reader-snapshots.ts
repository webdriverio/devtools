// The per-action captures a zip's frame-snapshot events name: each action's a11y text, and which capture it shows.

import { strFromU8 } from 'fflate'
import {
  TRACE_ZIP_ENTRIES,
  type TraceSnapshotSource
} from '@wdio/devtools-shared'
import {
  FRAME_RESOURCE_SUFFIXES,
  SCREENSHOT_URL_ORIGIN
} from './trace-reader-constants.js'
import type {
  FrameSnapshotEvent,
  TraceZipEntries
} from './trace-reader-types.js'

/** Resolve each per-action `-snapshot.txt` (a11y tree) resource, keyed by the
 *  command's callId. The frame-snapshot event names the resource via its pageId
 *  + original timestamp (wallTime), so this works regardless of whether the zip
 *  used the sparse or dense filmstrip. */
export function buildSnapshotTextByCallId(
  files: TraceZipEntries,
  frameSnapshots: FrameSnapshotEvent[]
): Map<string, string> {
  const byCallId = new Map<string, string>()
  for (const { snapshot } of frameSnapshots) {
    const data =
      files[`resources/${snapshot.pageId}-${snapshot.wallTime}-snapshot.txt`]
    if (data) {
      byCallId.set(snapshot.callId, strFromU8(data))
    }
  }
  return byCallId
}

const AFTER_SNAPSHOT_PREFIX = 'after@'

type FrameSnapshot = FrameSnapshotEvent['snapshot']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The stored screenshot this writer's override names; a foreign zip's overrides name page resources, so only one at this writer's screenshot origin counts. */
function overrideEntry(snapshot: FrameSnapshot): string | undefined {
  const overrides = Array.isArray(snapshot.resourceOverrides)
    ? snapshot.resourceOverrides
    : []
  const own = overrides.find(
    (override) =>
      isRecord(override) &&
      typeof override.url === 'string' &&
      override.url.startsWith(`${SCREENSHOT_URL_ORIGIN}/`) &&
      typeof override.sha1 === 'string'
  ) as { sha1: string } | undefined
  return own && `${TRACE_ZIP_ENTRIES.resourcesDir}/${own.sha1}`
}

/** Whether the document is the one the writer before stored screenshots wrote, with the image inlined in an <img> as a data URI. */
function inlinesScreenshot(html: unknown): boolean {
  const body = Array.isArray(html) ? html[3] : undefined
  const img = Array.isArray(body) ? body[2] : undefined
  const attributes = Array.isArray(img) ? img[1] : undefined
  return (
    isRecord(attributes) &&
    typeof attributes.src === 'string' &&
    attributes.src.startsWith('data:image/')
  )
}

/** The entry holding a claim's screenshot: the one its override names, else, for the writer that inlined it, the copy it also stored under the capture's stamp, as `-snapshot.txt` is. */
function imageEntry(
  snapshot: FrameSnapshot,
  names: ReadonlySet<string>
): string | undefined {
  const named = overrideEntry(snapshot)
  if (named) {
    return names.has(named) ? named : undefined
  }
  if (!inlinesScreenshot(snapshot.html)) {
    return undefined
  }
  const base = `${TRACE_ZIP_ENTRIES.resourcesDir}/${snapshot.pageId}-${snapshot.wallTime}`
  return FRAME_RESOURCE_SUFFIXES.map((suffix) => `${base}${suffix}`).find(
    (name) => names.has(name)
  )
}

/** The capture each action shows and its owner: the writer claims in action order, so a capture's first claimant is the action it was taken for, which the floored action times cannot say. */
export function buildSnapshotSources(
  frameSnapshots: FrameSnapshotEvent[],
  names: ReadonlySet<string>
): Record<string, TraceSnapshotSource> | undefined {
  const owners = new Map<string, string>()
  const sources = new Map<string, TraceSnapshotSource>()
  for (const { snapshot } of frameSnapshots) {
    if (!snapshot.snapshotName?.startsWith(AFTER_SNAPSHOT_PREFIX)) {
      continue
    }
    const capture = `${snapshot.pageId}-${snapshot.wallTime}`
    const ownerCallId = owners.get(capture) ?? snapshot.callId
    owners.set(capture, ownerCallId)
    const entry = imageEntry(snapshot, names)
    sources.set(snapshot.callId, {
      timestamp: snapshot.wallTime,
      ownerCallId,
      ...(entry ? { entry } : {})
    })
  }
  // fromEntries defines own properties, so a hostile callId such as `__proto__` stays a plain key.
  return sources.size ? Object.fromEntries(sources) : undefined
}
