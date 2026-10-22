// Native app network, read from the appium-interceptor plugin's proxy: a native app has no document and Appium serves no BiDi network events.

import { getRequestType, type NetworkRequest } from '@wdio/devtools-shared'
import { webdriverExecute, type WebDriverAddress } from './webdriver-http.js'

/** One entry of the plugin's `interceptor: getInterceptedData`. */
export interface InterceptedRequest {
  url: string
  method: string
  statusCode: number
  requestHeaders?: Record<string, string | string[]>
  requestBody?: unknown
  responseHeaders?: Record<string, string | string[]>
  responseBody?: unknown
}

export function flattenInterceptedHeaders(
  headers: InterceptedRequest['requestHeaders']
): Record<string, string> {
  const flat: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers ?? {})) {
    // The plugin files the response status line as a header ("http/1.1 201 created").
    if (/\s/.test(name)) {
      continue
    }
    flat[name] = Array.isArray(value) ? value.join(', ') : value
  }
  return flat
}

export function interceptedBodyText(body: unknown): string | undefined {
  if (body === undefined || body === null || body === '') {
    return undefined
  }
  return typeof body === 'string' ? body : JSON.stringify(body)
}

/** The plugin records no timing, so a row is stamped when it was first read. */
export function interceptedToNetworkRequest(
  entry: InterceptedRequest,
  id: string,
  observedAt: { timestamp: number; startTime: number }
): NetworkRequest {
  const responseHeaders = flattenInterceptedHeaders(entry.responseHeaders)
  const responseBody = interceptedBodyText(entry.responseBody)
  return {
    id,
    url: entry.url,
    method: entry.method,
    status: entry.statusCode,
    type: getRequestType(entry.url, responseHeaders['content-type']),
    timestamp: observedAt.timestamp,
    startTime: observedAt.startTime,
    endTime: observedAt.startTime,
    requestHeaders: flattenInterceptedHeaders(entry.requestHeaders),
    responseHeaders,
    response: {
      fromCache: false,
      headers: responseHeaders,
      mimeType: responseHeaders['content-type']?.split(';')[0]?.trim() ?? '',
      status: entry.statusCode
    },
    requestBody: interceptedBodyText(entry.requestBody),
    responseBody,
    size:
      responseBody === undefined ? undefined : Buffer.byteLength(responseBody)
  }
}

/** Talks to the plugin over raw WebDriver HTTP, so its commands never re-enter the client's hooks or render as action rows. */
export class InterceptorNetworkPoller {
  #address: WebDriverAddress
  #sessionId: string
  #listenerId?: string
  #seen = 0
  // Drains are chained: two overlapping reads would both list the entries past the same `#seen`.
  #tail: Promise<NetworkRequest[]> = Promise.resolve([])

  constructor(address: WebDriverAddress, sessionId: string) {
    this.#address = address
    this.#sessionId = sessionId
  }

  async start(): Promise<boolean> {
    const id = await webdriverExecute<string>(
      this.#address,
      this.#sessionId,
      'interceptor: startListening',
      [{}]
    )
    this.#listenerId = typeof id === 'string' ? id : undefined
    return this.#listenerId !== undefined
  }

  drain(): Promise<NetworkRequest[]> {
    this.#tail = this.#tail.then(() => this.#readFresh())
    return this.#tail
  }

  async #readFresh(): Promise<NetworkRequest[]> {
    const listenerId = this.#listenerId
    if (!listenerId) {
      return []
    }
    const data = await webdriverExecute<InterceptedRequest[]>(
      this.#address,
      this.#sessionId,
      'interceptor: getInterceptedData',
      [{ id: listenerId }]
    )
    if (!Array.isArray(data) || data.length <= this.#seen) {
      return []
    }
    const observedAt = { timestamp: Date.now(), startTime: performance.now() }
    const fresh = data
      .slice(this.#seen)
      .map((entry, offset) =>
        interceptedToNetworkRequest(
          entry,
          `interceptor-${listenerId}-${this.#seen + offset}`,
          observedAt
        )
      )
    this.#seen = data.length
    return fresh
  }
}
