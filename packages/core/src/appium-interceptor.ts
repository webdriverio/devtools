// Native app network, read from the appium-interceptor plugin's proxy: a native app has no document and Appium serves no BiDi network events.

import {
  getRequestType,
  isNativeAppSession,
  type NetworkRequest
} from '@wdio/devtools-shared'
import { errorMessage } from './error.js'

const INTERCEPT_CAPABILITY = 'appium:intercept'
const APPIUM_OPTIONS = 'appium:options'

/** Per-command drains are throttled to this: each read returns the listener's whole history, bodies included. */
export const NATIVE_NETWORK_DRAIN_INTERVAL_MS = 2000

/** Runs an Appium execute method (`interceptor: …`) outside the client's own command path, so it never renders as an action row. */
export type InterceptorExecute = (
  script: string,
  args: unknown[]
) => Promise<unknown>

export type NativeNetworkLog = (level: 'info' | 'warn', message: string) => void

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
    flat[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value
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

export class InterceptorNetworkPoller {
  #execute: InterceptorExecute
  #listenerId?: string
  #seen = 0
  // Drains are chained: two overlapping reads would both list the entries past the same `#seen`.
  #tail: Promise<NetworkRequest[]> = Promise.resolve([])

  constructor(execute: InterceptorExecute) {
    this.#execute = execute
  }

  async start(): Promise<boolean> {
    const id = await this.#execute('interceptor: startListening', [{}])
    this.#listenerId = typeof id === 'string' ? id : undefined
    return this.#listenerId !== undefined
  }

  drain(): Promise<NetworkRequest[]> {
    // A failed read is reported to its own caller; the next drain still runs.
    this.#tail = this.#tail.catch(() => []).then(() => this.#readFresh())
    return this.#tail
  }

  async #readFresh(): Promise<NetworkRequest[]> {
    const listenerId = this.#listenerId
    if (!listenerId) {
      return []
    }
    const data = await this.#execute('interceptor: getInterceptedData', [
      { id: listenerId }
    ])
    // A transport that answers failures with null would otherwise read as "nothing new".
    if (!Array.isArray(data)) {
      throw new Error('the plugin returned no intercepted data')
    }
    if (data.length <= this.#seen) {
      return []
    }
    const observedAt = { timestamp: Date.now(), startTime: performance.now() }
    const fresh = (data as InterceptedRequest[])
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

/** Whether one capability set asks for the proxy, directly or grouped under `appium:options`. */
function asksForIntercept(caps: unknown): boolean {
  if (!caps || typeof caps !== 'object') {
    return false
  }
  const map = caps as { get?: (key: string) => unknown } & Record<
    string,
    unknown
  >
  const read = (key: string) =>
    typeof map.get === 'function' ? map.get(key) : map[key]
  if (read(INTERCEPT_CAPABILITY) === true) {
    return true
  }
  const grouped = read(APPIUM_OPTIONS)
  return (
    !!grouped &&
    typeof grouped === 'object' &&
    (grouped as Record<string, unknown>).intercept === true
  )
}

/** Whether requested capabilities ask appium-interceptor for its proxy: flat, W3C-wrapped, or a selenium `Capabilities` map. */
export function requestsInterceptedNetwork(capabilities: unknown): boolean {
  if (asksForIntercept(capabilities)) {
    return true
  }
  if (!capabilities || typeof capabilities !== 'object') {
    return false
  }
  const { alwaysMatch, firstMatch } = capabilities as {
    alwaysMatch?: unknown
    firstMatch?: unknown
  }
  return [alwaysMatch, ...(Array.isArray(firstMatch) ? firstMatch : [])].some(
    asksForIntercept
  )
}

/** Where a session's intercepted requests come from, resolved by each adapter from its own client. */
export interface InterceptedNetworkTarget {
  requested: boolean
  capabilities: unknown
  /** Undefined when the adapter cannot reach the driver outside its own command path. */
  execute: InterceptorExecute | undefined
  /** Why `execute` is undefined, in the adapter's own terms. */
  unavailableReason?: string
}

export interface NetworkRequestSink {
  recordNetworkRequests(requests: NetworkRequest[]): void
}

/** Per-session lifecycle every adapter shares: start a listener per session, drain it into the capturer. */
export class NativeNetworkCapture {
  #sink: NetworkRequestSink
  #onLog: NativeNetworkLog
  #now: () => number
  #lastDrainAt = Number.NEGATIVE_INFINITY
  #poller?: InterceptorNetworkPoller
  // A start superseded by a later one (session replaced mid-handshake) must not install its poller.
  #generation = 0

  constructor(
    sink: NetworkRequestSink,
    onLog: NativeNetworkLog,
    now: () => number = Date.now
  ) {
    this.#sink = sink
    this.#onLog = onLog
    this.#now = now
  }

  /** Called per session: a listener dies with its session. */
  async start(target: InterceptedNetworkTarget | undefined): Promise<void> {
    const generation = ++this.#generation
    this.#poller = undefined
    if (!target?.requested || !isNativeAppSession(target.capabilities)) {
      return
    }
    if (!target.execute) {
      this.#onLog(
        'warn',
        `${INTERCEPT_CAPABILITY} is set but ${target.unavailableReason ?? 'the driver cannot be reached outside the command path'}; native network is not captured`
      )
      return
    }
    const poller = new InterceptorNetworkPoller(target.execute)
    const started = await poller.start().catch((err: unknown) => {
      this.#onLog(
        'warn',
        `appium-interceptor listener failed to start: ${errorMessage(err)}`
      )
      return false
    })
    if (generation !== this.#generation) {
      return
    }
    if (!started) {
      this.#onLog(
        'warn',
        `${INTERCEPT_CAPABILITY} is set but the interceptor listener did not start; is Appium running with --use-plugins=appium-interceptor?`
      )
      return
    }
    this.#onLog('info', 'Native network capture active via appium-interceptor')
    this.#poller = poller
    this.#lastDrainAt = Number.NEGATIVE_INFINITY
  }

  /** Whether a listener is running, so a caller can skip a drain that cannot find anything. */
  get active(): boolean {
    return this.#poller !== undefined
  }

  /** At session end, so a drain after the driver quit does not reach a dead session. */
  stop(): void {
    this.#generation++
    this.#poller = undefined
  }

  /** Lists what the proxy recorded since the last call. A test or session boundary must not pass `throttle`. */
  async forward(options: { throttle?: boolean } = {}): Promise<void> {
    const poller = this.#poller
    if (!poller) {
      return
    }
    const now = this.#now()
    if (
      options.throttle &&
      now - this.#lastDrainAt < NATIVE_NETWORK_DRAIN_INTERVAL_MS
    ) {
      return
    }
    this.#lastDrainAt = now
    const requests = await poller.drain().catch((err: unknown) => {
      this.#onLog(
        'warn',
        `Reading appium-interceptor data failed: ${errorMessage(err)}`
      )
      return []
    })
    if (requests.length > 0) {
      this.#sink.recordNetworkRequests(requests)
    }
  }
}
