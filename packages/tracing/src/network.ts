export interface ResourceSnapshotEvent {
  type: 'resource-snapshot'
  snapshot: {
    startedDateTime: string
    time: number
    request: {
      method: string
      url: string
      httpVersion: string
      cookies: Array<{ name: string; value: string }>
      headers: Array<{ name: string; value: string }>
      queryString: Array<{ name: string; value: string }>
      headersSize: number
      bodySize: number
    }
    response: {
      status: number
      statusText: string
      httpVersion: string
      cookies: Array<{ name: string; value: string }>
      headers: Array<{ name: string; value: string }>
      content: { size: number; mimeType: string }
      redirectURL: string
      headersSize: number
      bodySize: number
      _failureText?: string
    }
    cache: Record<string, never>
    timings: { send: number; wait: number; receive: number }
    _monotonicTime: number
    _frameref: string
  }
}

interface PendingRequest {
  url: string
  method: string
  isoTimestamp: string
  startMonotonic: number
  requestHeaders: Array<{ name: string; value: string }>
  frameref: string
}

type BiDiHeader = {
  name: string
  value: { type?: string; value?: string } | string
}

export class NetworkTracer {
  #pending = new Map<string, PendingRequest>()
  #entries: ResourceSnapshotEvent[] = []
  #getMonotonicMs: () => number

  constructor(getMonotonicMs: () => number) {
    this.#getMonotonicMs = getMonotonicMs
  }

  handleRequestStarted(event: {
    request: {
      request: string
      url: string
      method: string
      headers?: BiDiHeader[]
    }
    context?: string
    timestamp: number
  }): void {
    const { request, context, timestamp } = event
    this.#pending.set(request.request, {
      url: request.url,
      method: request.method,
      isoTimestamp: new Date(timestamp).toISOString(),
      startMonotonic: this.#getMonotonicMs(),
      requestHeaders: normalizeBiDiHeaders(request.headers),
      frameref: context ?? ''
    })
  }

  handleResponseCompleted(event: {
    request: { request: string }
    response: {
      status?: number
      statusText?: string
      headers?: BiDiHeader[]
      bytesReceived?: number
    }
  }): void {
    const pending = this.#pending.get(event.request.request)
    if (!pending) {
      return
    }
    this.#pending.delete(event.request.request)

    const endMonotonic = this.#getMonotonicMs()
    const responseHeaders = normalizeBiDiHeaders(event.response.headers)
    const contentType =
      responseHeaders.find((h) => h.name === 'content-type')?.value ?? ''
    if (!contentType || contentType === '-') {
      return
    }

    const elapsed = endMonotonic - pending.startMonotonic
    this.#entries.push({
      type: 'resource-snapshot',
      snapshot: {
        startedDateTime: pending.isoTimestamp,
        time: elapsed,
        request: {
          method: pending.method,
          url: pending.url,
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: pending.requestHeaders,
          queryString: parseQueryString(pending.url),
          headersSize: -1,
          bodySize: -1
        },
        response: {
          status: event.response.status ?? 0,
          statusText: event.response.statusText ?? '',
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: responseHeaders,
          content: {
            size: event.response.bytesReceived ?? -1,
            mimeType: contentType
          },
          redirectURL: '',
          headersSize: -1,
          bodySize: event.response.bytesReceived ?? -1
        },
        cache: {} as Record<string, never>,
        timings: { send: -1, wait: elapsed, receive: -1 },
        _monotonicTime: pending.startMonotonic / 1000,
        _frameref: pending.frameref
      }
    })
  }

  handleFetchError(event: { request: { request: string } }): void {
    this.#pending.delete(event.request.request)
  }

  get entries(): ResourceSnapshotEvent[] {
    return this.#entries
  }
}

function normalizeBiDiHeaders(
  headers?: BiDiHeader[]
): Array<{ name: string; value: string }> {
  if (!headers) {
    return []
  }
  return headers
    .map((h) => ({
      name: typeof h.name === 'string' ? h.name.toLowerCase() : '',
      value:
        typeof h.value === 'string' ? h.value : ((h.value as any)?.value ?? '')
    }))
    .filter((h) => h.name)
}

function parseQueryString(url: string): Array<{ name: string; value: string }> {
  try {
    return [...new URL(url).searchParams.entries()].map(([name, value]) => ({
      name,
      value
    }))
  } catch {
    return []
  }
}
