// The HAR stream an archive keeps, response bodies stored once under `resources/<sha1>`, without the collector's own reads.

import {
  NETWORK_CAPTURE_SOURCE,
  type NetworkRequest,
  type ResourceReRead,
  type TraceLog
} from '@wdio/devtools-shared'
import { networkRequestToHar } from './trace-har.js'
import type { TraceZipResource } from './trace-zip-writer.js'
import { sha1Hex } from './sha1.js'

/** Response bodies above this size are not embedded in the trace. */
const MAX_BODY_RESOURCE_BYTES = 1024 * 1024
/** Per-trace ceiling on total embedded response-body bytes. */
const MAX_TOTAL_BODY_RESOURCE_BYTES = 20 * 1024 * 1024

export interface NetworkBodyCaps {
  maxBodyBytes: number
  maxTotalBytes: number
}

export interface NetworkBodyResources {
  resources: TraceZipResource[]
  sha1ByRequestId: Map<string, string>
}

/** Content-addressed `resources/<sha1>` entries for captured response bodies. */
export function buildNetworkBodyResources(
  requests: NetworkRequest[],
  caps: NetworkBodyCaps = {
    maxBodyBytes: MAX_BODY_RESOURCE_BYTES,
    maxTotalBytes: MAX_TOTAL_BODY_RESOURCE_BYTES
  }
): NetworkBodyResources {
  const resources: TraceZipResource[] = []
  const sha1ByRequestId = new Map<string, string>()
  const stored = new Set<string>()
  let totalBytes = 0
  // Cap skips are silent by design; a warn hook would slot into these branches.
  for (const request of requests) {
    if (request.responseBody === undefined) {
      continue
    }
    const data = Buffer.from(request.responseBody, 'utf8')
    if (data.byteLength > caps.maxBodyBytes) {
      continue
    }
    const sha1 = sha1Hex(data)
    if (stored.has(sha1)) {
      sha1ByRequestId.set(request.id, sha1)
      continue
    }
    if (totalBytes + data.byteLength > caps.maxTotalBytes) {
      continue
    }
    stored.add(sha1)
    totalBytes += data.byteLength
    resources.push({ resourceName: sha1, data })
    sha1ByRequestId.set(request.id, sha1)
  }
  return { resources, sha1ByRequestId }
}

function buildNetworkNdjson(
  requests: NetworkRequest[],
  wallTime: number,
  pageId: string,
  sha1ByRequestId: Map<string, string>
): Buffer {
  if (!requests.length) {
    return Buffer.alloc(0)
  }
  const lines = requests.map((r) => {
    const entry = networkRequestToHar(r, {
      bodySha1: sha1ByRequestId.get(r.id)
    }) as unknown as Record<string, unknown>
    entry.snapshot = {
      ...(entry.snapshot as Record<string, unknown>),
      // Monotonic offset so the viewer positions bars on the timeline.
      _monotonicTime: Math.max(0, r.timestamp - wallTime),
      // Browsing context ID so the viewer associates requests with the page.
      _frameref: pageId
    }
    return JSON.stringify(entry)
  })
  return Buffer.from(lines.join('\n'), 'utf8')
}

/** The HAR stream and body resources, without the rows the collector's own resource reads produced. */
export function buildNetworkEntries(
  trace: Pick<TraceLog, 'networkRequests' | 'resourceReReads'>,
  wallTime: number,
  pageId: string
): { ndjson: Buffer; resources: TraceZipResource[] } {
  const rows = withoutResourceReReads(
    trace.networkRequests,
    trace.resourceReReads
  )
  const bodies = buildNetworkBodyResources(rows)
  return {
    ndjson: buildNetworkNdjson(rows, wallTime, pageId, bodies.sha1ByRequestId),
    resources: bodies.resources
  }
}

/** Browser-clock slack between the page's read start and the driver's event for it. */
const RE_READ_EARLIEST_MS = 100
/** The latest a driver-side row for a read can start after it. */
const RE_READ_LATEST_MS = 5000
/** What `Sec-Fetch-Dest` says about a page's own stylesheet or font load; a read is `empty`. */
const READ_FETCH_DEST = 'empty'

function fetchDestination(row: NetworkRequest): string | undefined {
  const headers = row.requestHeaders ?? {}
  const key = Object.keys(headers).find(
    (k) => k.toLowerCase() === 'sec-fetch-dest'
  )
  return key ? headers[key] : undefined
}

/** Only a row that could be a read: browser-clocked, driver-side, and not marked as the page's own load. */
function couldBeRead(row: NetworkRequest, read: ResourceReRead): boolean {
  if (
    row.url !== read.url ||
    row.wallTime === undefined ||
    row.source === NETWORK_CAPTURE_SOURCE.RESOURCE_TIMING
  ) {
    return false
  }
  const dest = fetchDestination(row)
  if (dest !== undefined && dest !== READ_FETCH_DEST) {
    return false
  }
  const earliest = Math.max(
    read.startedAt - RE_READ_EARLIEST_MS,
    (read.loadedAt + read.startedAt) / 2
  )
  return (
    row.wallTime >= earliest &&
    row.wallTime <= read.startedAt + RE_READ_LATEST_MS
  )
}

/** The rows without the one driver-side row each collector read produced; a row it cannot tell apart from a page load is kept. */
export function withoutResourceReReads(
  rows: readonly NetworkRequest[],
  reReads: readonly ResourceReRead[] | undefined
): NetworkRequest[] {
  if (!reReads?.length) {
    return [...rows]
  }
  const dropped = new Set<number>()
  for (const read of reReads) {
    let best = -1
    let bestDelta = Infinity
    rows.forEach((row, i) => {
      if (dropped.has(i) || !couldBeRead(row, read)) {
        return
      }
      const delta = Math.abs(row.wallTime! - read.startedAt)
      if (delta < bestDelta) {
        best = i
        bestDelta = delta
      }
    })
    if (best !== -1) {
      dropped.add(best)
    }
  }
  return rows.filter((_, i) => !dropped.has(i))
}
