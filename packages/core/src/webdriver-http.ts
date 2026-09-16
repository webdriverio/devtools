// Direct WebDriver HTTP transport for the capture probes.
//
// A probe issued from inside an adapter's own command hook re-enters the driver
// while the command it is meant to observe is still in flight. Where the driver
// serialises per session that probe enqueues behind that command and neither
// one resolves: Nightwatch's command queue does it always, Appium does it for a
// mobile-web session (#374, measured at 6m13s of timeouts against 1.6s without
// capture attached). Going straight to the driver's HTTP endpoint bypasses the
// queue the client library owns, which is the only escape that does not change
// the ordering guarantee the pre-action snapshot depends on.

import http from 'node:http'
import https from 'node:https'
import { errorMessage } from './error.js'

/** Ceiling on a single driver request — a driver that stops answering must not
 *  hold a capture open longer than the adapter's settle window. */
export const WEBDRIVER_REQUEST_TIMEOUT_MS = 5000

/** Where a driver is reachable, and what it needs to answer. Resolved by each
 *  adapter from its own client, since no two expose it the same way. */
export interface WebDriverAddress {
  hostname: string
  port: number
  /** Defaults to http. A cloud grid is https, and a plain-http transport
   *  reaches it as a connection error rather than an auth failure. */
  protocol?: string
  /** Base prefix ahead of `/session`, e.g. `/wd/hub`. WDIO's default is `/`. */
  path?: string
  /** Basic-auth pair for a cloud grid; sent only when both are present. */
  user?: string
  key?: string
  headers?: Record<string, string>
  /** Adapter's logger. Core carries no logging dependency of its own. */
  onWarn?: (message: string) => void
}

/** `/wd/hub` and `/` both reach us; only the former belongs in a URL. */
function basePrefix(path: string | undefined): string {
  if (!path || path === '/') {
    return ''
  }
  return path.endsWith('/') ? path.slice(0, -1) : path
}

/** An IPv6 literal has to be bracketed in a URL, or its own colons read as the
 *  port separator and the endpoint is unparseable — which would take a driver
 *  that is perfectly reachable and silently disable every direct probe. */
function formatHost(hostname: string): string {
  const isIpv6Literal = hostname.includes(':') && !hostname.startsWith('[')
  return isIpv6Literal ? `[${hostname}]` : hostname
}

export function sessionEndpoint(
  address: WebDriverAddress,
  sessionId: string,
  path: string
): string {
  const protocol = address.protocol ?? 'http'
  const prefix = basePrefix(address.path)
  const host = formatHost(address.hostname)
  return `${protocol}://${host}:${address.port}${prefix}/session/${sessionId}/${path}`
}

function authHeaders(address: WebDriverAddress): Record<string, string> {
  if (!address.user || !address.key) {
    return {}
  }
  const encoded = Buffer.from(`${address.user}:${address.key}`).toString(
    'base64'
  )
  return { authorization: `Basic ${encoded}` }
}

/** A W3C error payload: `value` carries `error`/`message` instead of the
 *  command's result. Shape-checked rather than status-checked because
 *  chromedriver answers some failures with a 200. */
function isWebdriverError(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { error?: unknown }).error === 'string'
  )
}

function requestHeaders(
  address: WebDriverAddress,
  payload: string | undefined
): Record<string, string> {
  return {
    ...authHeaders(address),
    ...address.headers,
    ...(payload
      ? {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(payload))
        }
      : {})
  }
}

function resolveFromResponse<T>(
  res: http.IncomingMessage,
  endpoint: string,
  warn: (message: string) => void,
  resolve: (value: T | null) => void
): void {
  let raw = ''
  let settled = false
  // Every path below has to land exactly once. `end` and `close` both fire on
  // a healthy response, and a reset fires `error` before either.
  const settle = (value: T | null) => {
    if (!settled) {
      settled = true
      resolve(value)
    }
  }
  res.on('data', (chunk: string | Buffer) => {
    raw += chunk
  })
  res.on('end', () => {
    try {
      const value = JSON.parse(raw).value
      // A W3C error answers 200-shaped JSON whose `value` is
      // `{error, message, stacktrace}` — an OBJECT where the caller expects
      // its payload. Casting that through as `T` put an error object into a
      // screencast frame's `data`, and the run's whole trace was then lost to
      // `Buffer.from(object)` at export.
      settle(isWebdriverError(value) ? null : ((value as T) ?? null))
    } catch {
      warn(`Failed to parse response from ${endpoint}`)
      settle(null)
    }
  })
  // A stream `error` with no listener is thrown, which would take the process
  // down over a probe; a reset after headers would otherwise never settle.
  res.on('error', (err: Error) => {
    warn(`Response failed (${endpoint}): ${errorMessage(err)}`)
    settle(null)
  })
  // Fires after `end` on a healthy response, where `settle` is already spent.
  // Reaching it first means the response was truncated.
  res.on('close', () => settle(null))
}

/** Resolves the W3C `value` field, or null on any transport/parse/timeout
 *  failure — a probe is best-effort and never fails the user's test. */
export function webdriverRequest<T>(
  address: WebDriverAddress,
  endpoint: string,
  method: 'GET' | 'POST',
  body?: unknown
): Promise<T | null> {
  const payload = body === undefined ? undefined : JSON.stringify(body)
  const transport = endpoint.startsWith('https:') ? https : http
  const warn = address.onWarn ?? (() => {})
  return new Promise((resolve) => {
    // `request` throws SYNCHRONOUSLY on an endpoint it cannot parse (a bare
    // IPv6 hostname is the reachable case). Unguarded that rejects the promise
    // instead of resolving null, and the rejection surfaces in the command
    // hook as a failure of the user's command rather than a skipped probe.
    let req: http.ClientRequest
    try {
      req = transport.request(
        endpoint,
        { method, headers: requestHeaders(address, payload) },
        (res) => resolveFromResponse<T>(res, endpoint, warn, resolve)
      )
    } catch (err) {
      warn(`Request could not be issued (${endpoint}): ${errorMessage(err)}`)
      resolve(null)
      return
    }
    req.on('error', (err) => {
      warn(`Request failed (${endpoint}): ${errorMessage(err)}`)
      resolve(null)
    })
    req.setTimeout(WEBDRIVER_REQUEST_TIMEOUT_MS, () => {
      warn(`Request timed out (${endpoint})`)
      req.destroy()
      resolve(null)
    })
    if (payload) {
      req.write(payload)
    }
    req.end()
  })
}

/** GET `/session/:id/<path>`. Null when the session is gone or the call fails. */
export function webdriverGet<T>(
  address: WebDriverAddress,
  sessionId: string,
  path: string
): Promise<T | null> {
  return webdriverRequest<T>(
    address,
    sessionEndpoint(address, sessionId, path),
    'GET'
  )
}

/** POST `/session/:id/<path>`. Null when the session is gone or the call fails. */
export function webdriverPost<T>(
  address: WebDriverAddress,
  sessionId: string,
  path: string,
  body: unknown
): Promise<T | null> {
  return webdriverRequest<T>(
    address,
    sessionEndpoint(address, sessionId, path),
    'POST',
    body
  )
}

/** Run a script in the page, outside whatever queue the client library owns.
 *  `body` is a function body, matching what `browser.execute` accepts. */
export function webdriverExecute<T>(
  address: WebDriverAddress,
  sessionId: string,
  body: string,
  args: unknown[] = []
): Promise<T | null> {
  return webdriverPost<T>(address, sessionId, 'execute/sync', {
    script: body,
    args
  })
}
