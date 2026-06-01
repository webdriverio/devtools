import { getRequestType } from './utils.js'

/**
 * Pure parsers for Chrome's `performance` log (the format `browser.getLog('performance')`
 * returns). Separated from the SessionCapturer so they're testable and the
 * capture method stays focused on state + I/O.
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
  type?: string
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
export function parseNetworkFromPerfLogs(logs: PerfLogEntry[]): NetworkEntry[] {
  const pending = new Map<string, NetworkEntry>()
  const completed: NetworkEntry[] = []

  for (const entry of logs) {
    let parsed: any
    try {
      parsed = JSON.parse(entry.message)
    } catch {
      continue
    }
    const method: string | undefined = parsed?.message?.method
    const params: any = parsed?.message?.params
    if (!method || !params) {
      continue
    }

    if (method === 'Network.requestWillBeSent') {
      const { requestId, request: req, timestamp } = params
      pending.set(requestId, {
        id: `${entry.timestamp}-${requestId}`,
        url: req.url,
        method: req.method,
        requestHeaders: req.headers,
        timestamp: Math.round(timestamp * 1000),
        startTime: entry.timestamp
      })
    } else if (method === 'Network.responseReceived') {
      const { requestId, response } = params
      const p = pending.get(requestId)
      if (p) {
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
    } else if (method === 'Network.loadingFinished') {
      const { requestId, encodedDataLength } = params
      const p = pending.get(requestId)
      if (p && p.status !== undefined) {
        p.size = encodedDataLength
        p.endTime = entry.timestamp
        p.time = entry.timestamp - p.startTime
        completed.push({ ...p })
        pending.delete(requestId)
      }
    } else if (method === 'Network.loadingFailed') {
      const { requestId, errorText } = params
      const p = pending.get(requestId)
      if (p) {
        p.error = errorText
        p.endTime = entry.timestamp
        p.time = entry.timestamp - p.startTime
        completed.push({ ...p })
        pending.delete(requestId)
      }
    }
  }

  return completed
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
