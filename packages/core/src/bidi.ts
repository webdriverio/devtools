import { createRequire } from 'node:module'
import type {
  ConsoleLog,
  LogLevel,
  NetworkRequest
} from '@wdio/devtools-shared'
import {
  LOG_SOURCES,
  chromeLogLevelToLogLevel,
  type LogSource
} from '@wdio/devtools-shared'
import { errorMessage } from './error.js'
import { getRequestType } from './net.js'

/**
 * Generic sinks the BiDi handlers push into. Each adapter wires these to its
 * own SessionCapturer state — selenium's `buildBidiSinks` is the canonical
 * example; nightwatch can mirror the pattern when it wires up BiDi.
 */
export interface BidiHandlerSinks {
  pushConsoleLog: (entry: ConsoleLog) => void
  pushNetworkRequest: (entry: NetworkRequest) => void
  replaceNetworkRequest: (id: string, entry: NetworkRequest) => void
}

/**
 * Resolve a `selenium-webdriver/<subpath>` module from the user's install
 * (preferred) or the package's local install (fallback). Returns `null` if
 * neither resolves — caller should treat as "BiDi not available on this
 * runtime" and degrade gracefully.
 *
 * Used by both selenium-devtools and (when wired up) nightwatch-devtools —
 * both ship selenium-webdriver-style drivers under the hood.
 */
export function loadSeleniumSubmodule<T = unknown>(subpath: string): T | null {
  try {
    const userRequire = createRequire(`${process.cwd()}/`)
    return userRequire(`selenium-webdriver/${subpath}`) as T
  } catch {
    try {
      const localRequire = createRequire(import.meta.url)
      return localRequire(`selenium-webdriver/${subpath}`) as T
    } catch {
      return null
    }
  }
}

type BidiLogger = (level: 'info' | 'warn', message: string) => void
type InspectorFactory = (driver: unknown) => Promise<unknown>

interface LogInspector {
  onConsoleEntry: (cb: (entry: unknown) => void) => Promise<void>
  onJavascriptException: (cb: (exc: unknown) => void) => Promise<void>
}

interface NetworkInspector {
  beforeRequestSent: (cb: (e: unknown) => void) => Promise<void>
  responseCompleted: (cb: (e: unknown) => void) => Promise<void>
  fetchError?: (cb: (e: unknown) => void) => Promise<void>
  /** The connection the inspector subscribed on, for one without the hook. */
  bidi?: {
    subscribe: (events: string | string[]) => Promise<unknown>
    socket?: {
      on: (event: 'message', listener: (raw: unknown) => void) => void
    }
  }
}

export function handleBidiConsoleEntry(
  rawEntry: unknown,
  sinks: BidiHandlerSinks,
  log: BidiLogger
): void {
  const entry = rawEntry as {
    level?: string
    type?: string
    text?: string
    message?: string
    timestamp?: number
  }
  try {
    const level = (entry?.level ?? entry?.type ?? 'info').toString()
    const text = entry?.text ?? entry?.message ?? ''
    sinks.pushConsoleLog({
      timestamp: Number(entry?.timestamp) || Date.now(),
      type: chromeLogLevelToLogLevel(level) as LogLevel,
      args: [text],
      source: LOG_SOURCES.BROWSER as LogSource
    })
  } catch (err) {
    log('warn', `onConsoleEntry handler threw: ${errorMessage(err)}`)
  }
}

export function handleBidiJsException(
  rawExc: unknown,
  sinks: BidiHandlerSinks,
  log: BidiLogger
): void {
  const exception = rawExc as { text?: string; message?: string }
  try {
    const text = exception?.text ?? exception?.message ?? String(rawExc)
    const trimmed = String(text).replace(/\s+/g, ' ').slice(0, 200)
    log(
      'warn',
      `🐛 JS error in page: ${trimmed}${String(text).length > 200 ? '…' : ''}`
    )
    sinks.pushConsoleLog({
      timestamp: Date.now(),
      type: 'error',
      args: [text],
      source: LOG_SOURCES.BROWSER as LogSource
    })
  } catch (err) {
    log('warn', `onJavascriptException handler threw: ${errorMessage(err)}`)
  }
}

async function attachLogInspector(
  driver: unknown,
  factory: InspectorFactory,
  sinks: BidiHandlerSinks,
  log: BidiLogger
): Promise<boolean> {
  try {
    const inspector = (await factory(driver)) as LogInspector
    await inspector.onConsoleEntry((e) => handleBidiConsoleEntry(e, sinks, log))
    await inspector.onJavascriptException((e) =>
      handleBidiJsException(e, sinks, log)
    )
    log('info', '✓ BiDi LogInspector attached (console + JS exceptions)')
    return true
  } catch (err) {
    log('warn', `BiDi LogInspector attach failed: ${errorMessage(err)}`)
    return false
  }
}

/** Subset of WebDriver BiDi `FetchTimingInfo` (selenium exposes these via
 *  getters). Values are ms offsets from the request baseline `requestTime`
 *  (usually 0), so `responseEnd - requestTime` is the request duration. */
interface FetchTimings {
  requestTime?: number
  responseEnd?: number
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

interface BeforeRequestSentEvent {
  request?: {
    request?: string
    url?: string
    method?: string
    headers?: unknown
    timings?: FetchTimings
  }
  id?: string
  timestamp?: number
}

interface ResponseCompletedEvent {
  request?: { request?: string; timings?: FetchTimings }
  id?: string
  timestamp?: number
  response?: {
    status?: number
    statusText?: string
    headers?: unknown
    mimeType?: string
    bytesReceived?: number
  }
}

/** Request duration (ms) from the browser's FetchTimingInfo, plus a derived
 *  endTime anchored to `startTime`. The browser timings are immune to BiDi
 *  events arriving batched in one tick (which collapses the event-level
 *  `timestamp`/`Date.now()` to a single value and yields 0-duration requests).
 *  Falls back to the timestamp diff only when timings are unavailable. */
function bidiResponseTiming(
  timings: FetchTimings | undefined,
  startTime: number,
  timestamp?: number
): { endTime: number; time: number } {
  if (
    timings &&
    isFiniteNumber(timings.requestTime) &&
    isFiniteNumber(timings.responseEnd) &&
    timings.responseEnd > timings.requestTime
  ) {
    const time = Math.round(timings.responseEnd - timings.requestTime)
    return { endTime: startTime + time, time }
  }
  const endTime = Number(timestamp ?? Date.now())
  return { endTime, time: Math.max(0, endTime - startTime) }
}

/** Rows a session has seen, by request id: a later event for the same request
 *  (a redirect hop, a late failure) continues the row rather than adding one. */
const MAX_TRACKED_REQUESTS = 5000

function remember(
  rows: Map<string, NetworkRequest>,
  id: string,
  entry: NetworkRequest
): void {
  rows.set(id, entry)
  if (rows.size <= MAX_TRACKED_REQUESTS) {
    return
  }
  // A row still open keeps its place: its answer has somewhere to land.
  for (const [key, row] of rows) {
    if (row.status !== undefined) {
      rows.delete(key)
      return
    }
  }
  rows.delete(rows.keys().next().value as string)
}

export function handleBidiRequestSent(
  rawEvent: unknown,
  rows: Map<string, NetworkRequest>,
  sinks: BidiHandlerSinks,
  log: BidiLogger
): void {
  const event = rawEvent as BeforeRequestSentEvent
  try {
    const requestId = String(event?.request?.request ?? event?.id ?? '')
    // selenium-webdriver's NetworkInspector hands every network event to every
    // subscriber's callback, so response and failure events reach this
    // handler too; taken as requests they pushed or reopened rows.
    const shape = rawEvent as { response?: unknown; errorText?: unknown }
    if (!requestId || shape?.response || shape?.errorText) {
      return
    }
    const previous = rows.get(requestId)
    const entry: NetworkRequest = {
      id: requestId,
      url: event?.request?.url ?? '',
      method: event?.request?.method ?? 'GET',
      requestHeaders: arrayHeadersToObject(event?.request?.headers),
      // A redirect hop re-sends the request under the same id: one row, which
      // keeps the clock of the hop it follows and reopens for the next answer.
      timestamp: previous?.timestamp ?? Date.now(),
      startTime: previous?.startTime ?? Number(event?.timestamp ?? Date.now()),
      type: getRequestType(event?.request?.url ?? '')
    }
    remember(rows, requestId, entry)
    if (previous) {
      sinks.replaceNetworkRequest(requestId, entry)
    } else {
      sinks.pushNetworkRequest(entry)
    }
  } catch (err) {
    log('warn', `beforeRequestSent threw: ${errorMessage(err)}`)
  }
}

export function handleBidiResponseCompleted(
  rawEvent: unknown,
  rows: Map<string, NetworkRequest>,
  sinks: BidiHandlerSinks,
  log: BidiLogger
): void {
  const event = rawEvent as ResponseCompletedEvent
  try {
    const requestId = String(event?.request?.request ?? event?.id ?? '')
    const previous = rows.get(requestId)
    // A request event delivered here (see handleBidiRequestSent) carries no
    // response; finalizing on it emptied the row.
    if (!previous || !event?.response) {
      return
    }
    const { endTime, time } = bidiResponseTiming(
      event?.request?.timings,
      previous.startTime,
      event?.timestamp
    )
    const finalized: NetworkRequest = {
      ...previous,
      status: Number(event?.response?.status) || previous.status,
      statusText: event?.response?.statusText ?? previous.statusText,
      responseHeaders: arrayHeadersToObject(event?.response?.headers),
      type: getRequestType(previous.url, event?.response?.mimeType),
      endTime,
      time,
      size: Number(event?.response?.bytesReceived) || undefined
    }
    remember(rows, requestId, finalized)
    sinks.replaceNetworkRequest(requestId, finalized)
  } catch (err) {
    log('warn', `responseCompleted threw: ${errorMessage(err)}`)
  }
}

interface FetchErrorEvent {
  request?: { request?: string; timings?: FetchTimings }
  id?: string
  timestamp?: number
  errorText?: string
}

/** A request the browser gave up on: closed as a failure, as the WDIO service
 *  closes its own, so it never sits in the Network tab as pending. */
export function handleBidiFetchError(
  rawEvent: unknown,
  rows: Map<string, NetworkRequest>,
  sinks: BidiHandlerSinks,
  log: BidiLogger
): void {
  const event = rawEvent as FetchErrorEvent
  try {
    const requestId = String(event?.request?.request ?? event?.id ?? '')
    const previous = rows.get(requestId)
    // The inspector delivers every network event here too; only a failure
    // carries `errorText`.
    if (!previous || typeof event?.errorText !== 'string') {
      return
    }
    const { endTime, time } = bidiResponseTiming(
      event?.request?.timings,
      previous.startTime,
      event?.timestamp
    )
    const errorText = event?.errorText ?? 'Failed'
    const finalized: NetworkRequest = {
      ...previous,
      status: 0,
      statusText: errorText,
      error: errorText,
      endTime,
      time
    }
    remember(rows, requestId, finalized)
    sinks.replaceNetworkRequest(requestId, finalized)
  } catch (err) {
    log('warn', `fetchError threw: ${errorMessage(err)}`)
  }
}

/** A failed fetch closes its row, or it would stay pending forever: through
 *  the inspector's own hook, or off the socket for an inspector without one. */
async function subscribeFetchErrors(
  inspector: NetworkInspector,
  rows: Map<string, NetworkRequest>,
  sinks: BidiHandlerSinks,
  log: BidiLogger
): Promise<void> {
  if (typeof inspector.fetchError === 'function') {
    await inspector.fetchError((e) => handleBidiFetchError(e, rows, sinks, log))
    return
  }
  const bidi = inspector.bidi
  if (typeof bidi?.subscribe !== 'function' || !bidi.socket?.on) {
    return
  }
  await bidi.subscribe('network.fetchError')
  bidi.socket.on('message', (raw) => {
    try {
      const { method, params } = JSON.parse(String(raw)) as {
        method?: string
        params?: unknown
      }
      if (method === 'network.fetchError') {
        handleBidiFetchError(params, rows, sinks, log)
      }
    } catch {
      /* a frame that is not JSON is not an event */
    }
  })
}

export async function attachNetworkInspector(
  driver: unknown,
  factory: InspectorFactory,
  sinks: BidiHandlerSinks,
  log: BidiLogger
): Promise<boolean> {
  try {
    const inspector = (await factory(driver)) as NetworkInspector
    const rows = new Map<string, NetworkRequest>()
    await inspector.beforeRequestSent((e) =>
      handleBidiRequestSent(e, rows, sinks, log)
    )
    await inspector.responseCompleted((e) =>
      handleBidiResponseCompleted(e, rows, sinks, log)
    )
    try {
      await subscribeFetchErrors(inspector, rows, sinks, log)
    } catch (err) {
      // The inspector is attached either way; only failed requests stay pending.
      log('warn', `BiDi network.fetchError unavailable: ${errorMessage(err)}`)
    }
    log('info', '✓ BiDi NetworkInspector attached (request + response)')
    return true
  } catch (err) {
    log('warn', `BiDi NetworkInspector attach failed: ${errorMessage(err)}`)
    return false
  }
}

/**
 * Attach the selenium-webdriver BiDi LogInspector + NetworkInspector to a
 * driver and route their events into the given sinks. Returns `true` when at
 * least one inspector connected — caller can disable the equivalent
 * script-injection collectors to avoid duplicates.
 *
 * Tolerant of older / non-BiDi runtimes: if either submodule fails to load
 * or the inspector factory throws (driver session doesn't have webSocketUrl
 * capability set, etc.), the corresponding stream is silently skipped and
 * the function returns false.
 *
 * @param onLog Optional callback for adapter-side logging. Receives ('info' |
 * 'warn', message) on lifecycle events. Default: silent — adapters wire their
 * own logger when they want visibility into BiDi attach state.
 */
export async function attachBidiHandlers(
  driver: unknown,
  sinks: BidiHandlerSinks,
  onLog?: (level: 'info' | 'warn', message: string) => void
): Promise<boolean> {
  const log: BidiLogger = (level, message) => onLog?.(level, message)
  const logFactory =
    loadSeleniumSubmodule<InspectorFactory>('bidi/logInspector')
  const networkFactory = loadSeleniumSubmodule<InspectorFactory>(
    'bidi/networkInspector'
  )

  let attached = 0
  if (typeof logFactory === 'function') {
    if (await attachLogInspector(driver, logFactory, sinks, log)) {
      attached++
    }
  } else {
    log('info', 'selenium-webdriver/bidi/logInspector not available — skipping')
  }
  if (typeof networkFactory === 'function') {
    if (await attachNetworkInspector(driver, networkFactory, sinks, log)) {
      attached++
    }
  } else {
    log(
      'info',
      'selenium-webdriver/bidi/networkInspector not available — skipping'
    )
  }
  return attached > 0
}

/**
 * Flatten BiDi's `Array<{name, value:{value|type}}>` header shape to a
 * lowercased `Record<string, string>`. Exported so adapter-side helpers can
 * reuse it for their own header normalization.
 */
export function arrayHeadersToObject(
  headers: unknown
): Record<string, string> | undefined {
  if (!Array.isArray(headers)) {
    return undefined
  }
  const out: Record<string, string> = {}
  for (const h of headers as Array<{
    name?: string
    value?: string | { value?: string; type?: string }
  }>) {
    const name = String(h?.name ?? '').toLowerCase()
    if (!name) {
      continue
    }
    const v = h?.value
    out[name] =
      typeof v === 'string'
        ? v
        : typeof (v as { value?: string })?.value === 'string'
          ? (v as { value: string }).value
          : JSON.stringify(v ?? '')
  }
  return out
}
