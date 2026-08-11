// Direct WebDriver HTTP transport for the capture probes.
//
// Every probe the trace capture makes — url, title, screenshot, in-page script
// — has to bypass Nightwatch's command queue. `browser.*` commands are QUEUED,
// so a probe the plugin issues from inside its own command hook enqueues behind
// the command that is still running and cannot resolve until the queue drains.
// Unguarded, one such probe stranded the whole per-action snapshot capture; the
// in-page script probe merely timed out, leaving empty a11y trees.

import http from 'node:http'
import logger from '@wdio/logger'
import { errorMessage } from '@wdio/devtools-core'
import type { NightwatchBrowser } from '../types.js'

const log = logger('@wdio/nightwatch-devtools:webdriverHttp')

/** Ceiling on a single driver request — a driver that stops answering must not
 *  hold a capture open longer than the adapter's settle window. */
const REQUEST_TIMEOUT_MS = 5000

type LooseRec = Record<string, unknown>

const getProp = (obj: unknown, key: string): unknown =>
  obj && typeof obj === 'object' ? (obj as LooseRec)[key] : undefined

const getPath = (obj: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((acc, k) => getProp(acc, k), obj)

const firstDefined = (obj: unknown, ...keys: string[]): unknown => {
  if (!obj || typeof obj !== 'object') {
    return undefined
  }
  const rec = obj as LooseRec
  for (const k of keys) {
    const v = rec[k]
    if (v !== undefined && v !== null) {
      return v
    }
  }
  return undefined
}

/**
 * Walks Nightwatch's internal config (transport / queue.transport /
 * nightwatchInstance — none of which are on the public NightwatchBrowser type)
 * to find the underlying WebDriver host+port.
 */
export function resolveWebDriverAddress(browser: NightwatchBrowser): {
  driverHost: string
  driverPort: number
} {
  const transportSettings =
    getPath(browser, 'transport', 'settings', 'webdriver') ||
    getPath(browser, 'queue', 'transport', 'settings', 'webdriver') ||
    getPath(
      browser,
      'nightwatchInstance',
      'transport',
      'settings',
      'webdriver'
    ) ||
    {}
  const opts = getProp(browser, 'options') ?? {}
  const nightwatchSettings =
    getPath(browser, 'nightwatchInstance', 'settings') ||
    getPath(browser, 'globals', 'nightwatchInstance', 'settings') ||
    {}
  const driverHost = String(
    firstDefined(transportSettings, 'host', 'server_address') ||
      firstDefined(getProp(opts, 'webdriver'), 'host') ||
      firstDefined(getProp(nightwatchSettings, 'webdriver'), 'host') ||
      'localhost'
  )
  const driverPort = Number(
    firstDefined(transportSettings, 'port') ||
      firstDefined(getProp(opts, 'webdriver'), 'port') ||
      firstDefined(getProp(nightwatchSettings, 'webdriver'), 'port') ||
      9515
  )
  return { driverHost, driverPort }
}

function sessionEndpoint(
  browser: NightwatchBrowser,
  path: string
): string | undefined {
  const sessionId = (browser as unknown as { sessionId?: string }).sessionId
  if (!sessionId) {
    return undefined
  }
  const { driverHost, driverPort } = resolveWebDriverAddress(browser)
  return `http://${driverHost}:${driverPort}/session/${sessionId}/${path}`
}

/** A W3C error payload: `value` carries `error`/`message` instead of the
 *  command's result. Shape-checked rather than status-checked because chromedriver
 *  answers some failures with a 200. */
function isWebdriverError(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { error?: unknown }).error === 'string'
  )
}

/** Resolves the W3C `value` field, or null on any transport/parse/timeout
 *  failure — a probe is best-effort and never fails the user's test. */
function request<T>(
  endpoint: string,
  method: 'GET' | 'POST',
  body?: unknown
): Promise<T | null> {
  const payload = body === undefined ? undefined : JSON.stringify(body)
  return new Promise((resolve) => {
    const req = http.request(
      endpoint,
      {
        method,
        headers: payload
          ? {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(payload)
            }
          : undefined
      },
      (res) => {
        let raw = ''
        res.on('data', (chunk: string | Buffer) => {
          raw += chunk
        })
        res.on('end', () => {
          try {
            const value = JSON.parse(raw).value
            // A W3C error answers 200-shaped JSON whose `value` is
            // `{error, message, stacktrace}` — an OBJECT where the caller
            // expects its payload. Casting that through as `T` put an error
            // object into a screencast frame's `data`, and the run's whole
            // trace was then lost to `Buffer.from(object)` at export.
            resolve(isWebdriverError(value) ? null : ((value as T) ?? null))
          } catch {
            log.warn(`Failed to parse response from ${endpoint}`)
            resolve(null)
          }
        })
      }
    )
    req.on('error', (err) => {
      log.warn(`Request failed (${endpoint}): ${errorMessage(err)}`)
      resolve(null)
    })
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      log.warn(`Request timed out (${endpoint})`)
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
  browser: NightwatchBrowser,
  path: string
): Promise<T | null> {
  const endpoint = sessionEndpoint(browser, path)
  return endpoint ? request<T>(endpoint, 'GET') : Promise.resolve(null)
}

/** POST `/session/:id/<path>`. Null when the session is gone or the call fails. */
export function webdriverPost<T>(
  browser: NightwatchBrowser,
  path: string,
  body: unknown
): Promise<T | null> {
  const endpoint = sessionEndpoint(browser, path)
  return endpoint ? request<T>(endpoint, 'POST', body) : Promise.resolve(null)
}

/** Run a script in the page, outside the command queue. `body` is a function
 *  body, matching what `browser.execute` accepts. */
export function webdriverExecute<T>(
  browser: NightwatchBrowser,
  body: string
): Promise<T | null> {
  return webdriverPost<T>(browser, 'execute/sync', { script: body, args: [] })
}
