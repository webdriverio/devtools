// Convert the existing NetworkRequest shape into trace format
// `resource-snapshot` NDJSON entries (HAR-flavoured) for trace.zip.

import type { NetworkRequest } from '@wdio/devtools-shared'

export interface ResourceSnapshotEntry {
  type: 'resource-snapshot'
  snapshot: {
    startedDateTime: string
    time: number
    request: {
      method: string
      url: string
      httpVersion: string
      cookies: unknown[]
      headers: { name: string; value: string }[]
      queryString: { name: string; value: string }[]
      headersSize: number
      bodySize: number
    }
    response: {
      status: number
      statusText: string
      httpVersion: string
      cookies: unknown[]
      headers: { name: string; value: string }[]
      content: { size: number; mimeType: string }
      redirectURL: string
      headersSize: number
      bodySize: number
    }
    cache: Record<string, never>
    timings: { send: number; wait: number; receive: number }
  }
}

function toHeaderArray(
  h: Record<string, string> | undefined
): { name: string; value: string }[] {
  if (!h) {
    return []
  }
  return Object.entries(h).map(([name, value]) => ({ name, value }))
}

function toQueryString(url: string): { name: string; value: string }[] {
  try {
    const u = new URL(url)
    const out: { name: string; value: string }[] = []
    u.searchParams.forEach((value, name) => out.push({ name, value }))
    return out
  } catch {
    return []
  }
}

export function networkRequestToHar(
  entry: NetworkRequest
): ResourceSnapshotEntry {
  const startedDateTime = new Date(entry.timestamp).toISOString()
  const duration =
    entry.time ?? (entry.endTime ?? entry.startTime) - entry.startTime
  const status = entry.response?.status ?? entry.status ?? 0
  const mimeType = entry.response?.mimeType ?? ''
  const responseHeaders = entry.response?.headers ?? entry.responseHeaders
  return {
    type: 'resource-snapshot',
    snapshot: {
      startedDateTime,
      time: Math.max(0, duration),
      request: {
        method: entry.method,
        url: entry.url,
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: toHeaderArray(entry.requestHeaders ?? entry.headers),
        queryString: toQueryString(entry.url),
        headersSize: -1,
        bodySize: entry.requestBody ? entry.requestBody.length : -1
      },
      response: {
        status,
        statusText: entry.statusText ?? '',
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: toHeaderArray(responseHeaders),
        content: { size: entry.size ?? 0, mimeType },
        redirectURL: '',
        headersSize: -1,
        bodySize: entry.size ?? -1
      },
      cache: {},
      timings: {
        send: 0,
        wait: Math.max(0, duration),
        receive: 0
      }
    }
  }
}
