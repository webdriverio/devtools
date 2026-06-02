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
} from './console.js'
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
  const log = (level: 'info' | 'warn', message: string) =>
    onLog?.(level, message)

  type InspectorFactory = (driver: unknown) => Promise<unknown>
  const logInspectorFactory =
    loadSeleniumSubmodule<InspectorFactory>('bidi/logInspector')
  const networkInspectorFactory = loadSeleniumSubmodule<InspectorFactory>(
    'bidi/networkInspector'
  )

  let attached = 0

  if (typeof logInspectorFactory === 'function') {
    try {
      const inspector = (await logInspectorFactory(driver)) as {
        onConsoleEntry: (cb: (entry: unknown) => void) => Promise<void>
        onJavascriptException: (cb: (exc: unknown) => void) => Promise<void>
      }
      await inspector.onConsoleEntry((rawEntry) => {
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
      })
      await inspector.onJavascriptException((rawExc) => {
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
          log(
            'warn',
            `onJavascriptException handler threw: ${errorMessage(err)}`
          )
        }
      })
      attached++
      log('info', '✓ BiDi LogInspector attached (console + JS exceptions)')
    } catch (err) {
      log('warn', `BiDi LogInspector attach failed: ${errorMessage(err)}`)
    }
  } else {
    log('info', 'selenium-webdriver/bidi/logInspector not available — skipping')
  }

  if (typeof networkInspectorFactory === 'function') {
    try {
      const inspector = (await networkInspectorFactory(driver)) as {
        beforeRequestSent: (cb: (e: unknown) => void) => Promise<void>
        responseCompleted: (cb: (e: unknown) => void) => Promise<void>
      }
      const pending = new Map<string, NetworkRequest>()

      await inspector.beforeRequestSent((rawEvent) => {
        const event = rawEvent as {
          request?: {
            request?: string
            url?: string
            method?: string
            headers?: unknown
          }
          id?: string
          timestamp?: number
        }
        try {
          const requestId = String(event?.request?.request ?? event?.id ?? '')
          if (!requestId) {
            return
          }
          const entry: NetworkRequest = {
            id: requestId,
            url: event?.request?.url ?? '',
            method: event?.request?.method ?? 'GET',
            requestHeaders: arrayHeadersToObject(event?.request?.headers),
            timestamp: Date.now(),
            startTime: Number(event?.timestamp ?? Date.now()),
            type: getRequestType(event?.request?.url ?? '')
          }
          pending.set(requestId, entry)
          sinks.pushNetworkRequest(entry)
        } catch (err) {
          log('warn', `beforeRequestSent threw: ${errorMessage(err)}`)
        }
      })

      await inspector.responseCompleted((rawEvent) => {
        const event = rawEvent as {
          request?: { request?: string }
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
        try {
          const requestId = String(event?.request?.request ?? event?.id ?? '')
          const previous = pending.get(requestId)
          if (!previous) {
            return
          }
          const finalized: NetworkRequest = {
            ...previous,
            status: Number(event?.response?.status) || previous.status,
            statusText: event?.response?.statusText ?? previous.statusText,
            responseHeaders: arrayHeadersToObject(event?.response?.headers),
            type: getRequestType(previous.url, event?.response?.mimeType),
            endTime: Number(event?.timestamp ?? Date.now()),
            time: Number(event?.timestamp ?? Date.now()) - previous.startTime,
            size: Number(event?.response?.bytesReceived) || undefined
          }
          pending.delete(requestId)
          sinks.replaceNetworkRequest(requestId, finalized)
        } catch (err) {
          log('warn', `responseCompleted threw: ${errorMessage(err)}`)
        }
      })

      attached++
      log('info', '✓ BiDi NetworkInspector attached (request + response)')
    } catch (err) {
      log('warn', `BiDi NetworkInspector attach failed: ${errorMessage(err)}`)
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
