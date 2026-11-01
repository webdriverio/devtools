import {
  NETWORK_CAPTURE_SOURCE,
  type NetworkRequest,
  type RequestType
} from '@wdio/devtools-shared'

import { getRequestType } from './utils.js'

/** How far apart the log's and the page's clocks for one load may be and
 *  still describe the same request. */
const RESOURCE_TIMING_MATCH_MS = 2000

/**
 * Pure parsers for Chrome's `performance` log (the entries
 * `POST /session/:id/se/log` returns for `{ type: 'performance' }`). Separated
 * from the SessionCapturer so they're testable and the capture method stays
 * focused on state + I/O.
 */

export interface PerfLogEntry {
  level: string
  message: string
  timestamp: number
}

export interface NetworkEntry {
  id: string
  url: string
  method: string
  requestHeaders: Record<string, string>
  timestamp: number
  startTime: number
  status?: number
  statusText?: string
  responseHeaders?: Record<string, string>
  mimeType?: string
  /** Set only by `getRequestType`, so it carries the shared vocabulary; absent
   *  until the response event arrives. */
  type?: RequestType
  size?: number
  endTime?: number
  time?: number
  error?: string
}

/**
 * Parse CDP `Network.*` events out of Chrome performance log entries into a
 * flat array of network entries. Builds up a per-requestId pending map as it
 * sees `requestWillBeSent` → `responseReceived` → `loadingFinished` events,
 * and emits the completed entry on the terminal event.
 */
interface CdpResponse {
  status?: number
  statusText?: string
  headers?: Record<string, unknown>
  mimeType?: string
}

interface CdpRequest {
  url: string
  method: string
  headers?: Record<string, string>
}

interface CdpEventParams {
  requestId: string
  request?: CdpRequest
  response?: CdpResponse
  timestamp?: number
  wallTime?: number
  encodedDataLength?: number
  errorText?: string
}

function applyResponseReceived(p: NetworkEntry, response: CdpResponse): void {
  const responseHeaders: Record<string, string> = {}
  for (const [k, v] of Object.entries(response.headers || {})) {
    responseHeaders[k.toLowerCase()] = String(v)
  }
  p.status = response.status
  p.statusText = response.statusText
  p.responseHeaders = responseHeaders
  p.mimeType = response.mimeType
  p.type = getRequestType(p.url, response.mimeType)
}

/** CDP event time in ms. Uses the event's own monotonic `params.timestamp`
 *  (what Chrome DevTools times requests with) rather than the perf-log wrapper
 *  timestamp, which WebDriver stamps per batch — so request/response diffs in
 *  the same batch would otherwise be 0. */
function eventTimeMs(params: CdpEventParams, entry: PerfLogEntry): number {
  return typeof params.timestamp === 'number'
    ? Math.round(params.timestamp * 1000)
    : entry.timestamp
}

function startPendingRequest(
  params: CdpEventParams,
  entry: PerfLogEntry,
  pending: Map<string, NetworkEntry>
): void {
  const { requestId, request: req, timestamp } = params
  if (!req || typeof timestamp !== 'number') {
    return
  }
  const startTime = eventTimeMs(params, entry)
  pending.set(requestId, {
    id: `${entry.timestamp}-${requestId}`,
    url: req.url,
    method: req.method,
    requestHeaders: req.headers ?? {},
    // Epoch, from the event's own wall clock: every consumer dates a row by
    // `timestamp`, and the monotonic `startTime` only diffs within a session.
    timestamp:
      typeof params.wallTime === 'number'
        ? Math.round(params.wallTime * 1000)
        : entry.timestamp,
    startTime
  })
}

function handlePerfLogEvent(
  method: string,
  params: CdpEventParams,
  entry: PerfLogEntry,
  pending: Map<string, NetworkEntry>,
  completed: NetworkEntry[]
): void {
  if (method === 'Network.requestWillBeSent') {
    startPendingRequest(params, entry, pending)
    return
  }
  if (method === 'Network.responseReceived') {
    const p = pending.get(params.requestId)
    if (p && params.response) {
      applyResponseReceived(p, params.response)
    }
    return
  }
  if (method === 'Network.loadingFinished') {
    const p = pending.get(params.requestId)
    if (p && p.status !== undefined) {
      p.size = params.encodedDataLength
      p.endTime = eventTimeMs(params, entry)
      p.time = Math.max(0, p.endTime - p.startTime)
      completed.push({ ...p })
      pending.delete(params.requestId)
    }
    return
  }
  if (method === 'Network.loadingFailed') {
    const p = pending.get(params.requestId)
    if (p) {
      p.error = params.errorText
      p.endTime = eventTimeMs(params, entry)
      p.time = Math.max(0, p.endTime - p.startTime)
      completed.push({ ...p })
      pending.delete(params.requestId)
    }
  }
}

export function parseNetworkFromPerfLogs(logs: PerfLogEntry[]): NetworkEntry[] {
  const pending = new Map<string, NetworkEntry>()
  const completed: NetworkEntry[] = []
  for (const entry of logs) {
    let parsed: unknown
    try {
      parsed = JSON.parse(entry.message)
    } catch {
      continue
    }
    type ParsedShape = {
      message?: { method?: string; params?: CdpEventParams }
    }
    const message = (parsed as ParsedShape | undefined)?.message
    const method = message?.method
    const params = message?.params
    if (!method || !params) {
      continue
    }
    handlePerfLogEvent(method, params, entry, pending, completed)
  }
  return completed
}

export interface ResourceTimingUpgrade {
  index: number
  request: NetworkRequest
}

/** The Resource Timing rows under each url, by index: the rows a load another
 *  source reported can be paired with. */
function resourceTimingRowsByUrl(
  rows: NetworkRequest[]
): Map<string, number[]> {
  const byUrl = new Map<string, number[]>()
  rows.forEach((row, index) => {
    if (row.source !== NETWORK_CAPTURE_SOURCE.RESOURCE_TIMING) {
      return
    }
    const indexes = byUrl.get(row.url)
    if (indexes) {
      indexes.push(index)
    } else {
      byUrl.set(row.url, [index])
    }
  })
  return byUrl
}

/** The unmatched Resource Timing row for this url nearest `at`, spent once
 *  taken so each load pairs with one row. */
function takeNearestResourceTimingRow(
  indexes: number[],
  rows: NetworkRequest[],
  at: number
): number | undefined {
  let best: number | undefined
  let bestDelta = RESOURCE_TIMING_MATCH_MS
  for (const index of indexes) {
    const delta = Math.abs(rows[index].timestamp - at)
    if (delta <= bestDelta) {
      best = index
      bestDelta = delta
    }
  }
  if (best !== undefined) {
    indexes.splice(indexes.indexOf(best), 1)
  }
  return best
}

/** What the log saw that the page could not, laid over the page's row: its
 *  clock, its measured phases and its id stay the row's. */
function overlay(row: NetworkRequest, entry: NetworkEntry): NetworkRequest {
  const merged: NetworkRequest = {
    ...row,
    method: entry.method,
    requestHeaders: entry.requestHeaders,
    type: entry.type ?? row.type,
    ...(entry.status !== undefined ? { status: entry.status } : {}),
    ...(entry.statusText !== undefined ? { statusText: entry.statusText } : {}),
    ...(entry.responseHeaders
      ? { responseHeaders: entry.responseHeaders }
      : {}),
    ...(entry.size !== undefined ? { size: entry.size } : {}),
    ...(entry.error !== undefined ? { error: entry.error } : {})
  }
  delete merged.source
  return merged
}

/** A load the log listed before the page could: the log is read after the
 *  drain, so the page's row for it arrives a drain later. */
export interface LoadListedByLog {
  url: string
  timestamp: number
}

/** A drained payload without the page's row for each load the log listed
 *  first. A load takes one row, the nearest under its url, so a second request
 *  to that url inside the window keeps its own. */
export function withoutLoadsTheLogListed(
  payload: Record<string, unknown>,
  listed: LoadListedByLog[]
): Record<string, unknown> {
  const requests = payload.networkRequests
  if (!Array.isArray(requests) || listed.length === 0) {
    return payload
  }
  const rows = requests as NetworkRequest[]
  const rowsByUrl = resourceTimingRowsByUrl(rows)
  const taken = new Set<number>()
  for (const load of listed) {
    const index = takeNearestResourceTimingRow(
      rowsByUrl.get(load.url) ?? [],
      rows,
      load.timestamp
    )
    if (index !== undefined) {
      taken.add(index)
    }
  }
  if (taken.size === 0) {
    return payload
  }
  return {
    ...payload,
    networkRequests: rows.filter((_, index) => !taken.has(index))
  }
}

/**
 * Pair performance-log entries with the Resource Timing rows the session
 * already holds for the same loads. The page's drain runs before the log is
 * read, so its rows arrive first; a pair takes the row's id and replaces it in
 * place with the headers and status the page could not see, which is what the
 * dashboard does with a re-sent id. The rest are new to the session.
 */
export function upgradeResourceTimingRows(
  incoming: NetworkEntry[],
  existing: NetworkRequest[]
): { upgrades: ResourceTimingUpgrade[]; fresh: NetworkEntry[] } {
  const rowsByUrl = resourceTimingRowsByUrl(existing)
  const upgrades: ResourceTimingUpgrade[] = []
  const fresh: NetworkEntry[] = []
  for (const entry of incoming) {
    const index = takeNearestResourceTimingRow(
      rowsByUrl.get(entry.url) ?? [],
      existing,
      entry.timestamp
    )
    if (index === undefined) {
      fresh.push(entry)
      continue
    }
    upgrades.push({ index, request: overlay(existing[index], entry) })
  }
  return { upgrades, fresh }
}

/**
 * Dedupe incoming network entries against ones the session already holds.
 * Successful requests dedupe by (method, url, timestamp). Failed requests
 * collapse by (method, origin, pathname) — parallel autocomplete/prefetch
 * requests to the same path (e.g. `/search?q=W`, `/search?q=We`) otherwise
 * spam the network panel.
 */
export function dedupeNetworkRequests(
  incoming: NetworkEntry[],
  existing: NetworkEntry[]
): NetworkEntry[] {
  const failedKey = (entry: NetworkEntry): string => {
    try {
      const u = new URL(entry.url)
      return `err:${entry.method}:${u.origin}${u.pathname}`
    } catch {
      return `err:${entry.method}:${entry.url}`
    }
  }

  const alreadySeen = new Set(
    existing.map((r) =>
      r.error !== undefined
        ? failedKey(r)
        : `ok:${r.method}:${r.url}:${r.timestamp}`
    )
  )

  const deduped: NetworkEntry[] = []
  const seenFailedInBatch = new Map<string, number>()

  for (const entry of incoming) {
    if (entry.error !== undefined) {
      const key = failedKey(entry)
      if (alreadySeen.has(key)) {
        continue
      }
      const existingIdx = seenFailedInBatch.get(key)
      if (existingIdx !== undefined) {
        deduped[existingIdx] = entry // replace with latest failure
      } else {
        seenFailedInBatch.set(key, deduped.length)
        deduped.push(entry)
      }
    } else {
      const key = `ok:${entry.method}:${entry.url}:${entry.timestamp}`
      if (!alreadySeen.has(key)) {
        deduped.push(entry)
      }
    }
  }

  return deduped
}
