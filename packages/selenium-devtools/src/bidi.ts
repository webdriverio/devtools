import { createRequire } from 'node:module'
import logger from '@wdio/logger'
import { errorMessage } from '@wdio/devtools-core'
import { LOG_SOURCES } from './constants.js'
import { chromeLogLevelToLogLevel, getRequestType } from './helpers/utils.js'
import type { BidiHandlerSinks, LogLevel, NetworkRequest } from './types.js'
import type { SessionCapturer } from './session.js'

const log = logger('@wdio/selenium-devtools:bidi')

function loadSeleniumSubmodule(subpath: string): any | null {
  try {
    const userRequire = createRequire(`${process.cwd()}/`)
    return userRequire(`selenium-webdriver/${subpath}`)
  } catch {
    try {
      const localRequire = createRequire(import.meta.url)
      return localRequire(`selenium-webdriver/${subpath}`)
    } catch {
      return null
    }
  }
}

// Sets webSocketUrl=true so the driver actually exposes the BiDi channel.
export function ensureBidiCapability(builder: any): void {
  try {
    const caps =
      typeof builder?.getCapabilities === 'function'
        ? builder.getCapabilities()
        : null
    if (!caps || typeof caps.set !== 'function') {
      return
    }
    if (typeof caps.has === 'function' && caps.has('webSocketUrl')) {
      return
    }
    caps.set('webSocketUrl', true)
    log.info('Set webSocketUrl=true on builder capabilities (BiDi enabled)')
  } catch (err) {
    log.warn(`Failed to set webSocketUrl capability: ${errorMessage(err)}`)
  }
}

// `--headless=old` (not `=new`) — `new` produces all-black frames under
// CDP `Page.startScreencast` on macOS (upstream Chrome bug).
export function ensureHeadlessChrome(builder: any): void {
  try {
    const caps =
      typeof builder?.getCapabilities === 'function'
        ? builder.getCapabilities()
        : null
    if (!caps || typeof caps.get !== 'function') {
      return
    }
    const existing = caps.get('goog:chromeOptions') ?? {}
    const args: string[] = Array.isArray(existing.args)
      ? [...existing.args]
      : []
    const hasHeadless = args.some(
      (a) => typeof a === 'string' && a.startsWith('--headless')
    )
    if (hasHeadless) {
      return
    }
    args.push('--headless=old')
    caps.set('goog:chromeOptions', { ...existing, args })
    log.info('Injected --headless=old into Chrome capabilities')
  } catch (err) {
    log.warn(`Failed to set headless Chrome option: ${errorMessage(err)}`)
  }
}

// Returns true when at least one stream connected — caller disables the
// equivalent script-injection collectors to avoid duplicates.
export async function attachBidiHandlers(
  driver: any,
  sinks: BidiHandlerSinks
): Promise<boolean> {
  const logInspectorFactory = loadSeleniumSubmodule('bidi/logInspector')
  const networkInspectorFactory = loadSeleniumSubmodule('bidi/networkInspector')

  let attached = 0

  if (typeof logInspectorFactory === 'function') {
    try {
      const inspector = await logInspectorFactory(driver)
      await inspector.onConsoleEntry((entry: any) => {
        try {
          const level = (entry?.level ?? entry?.type ?? 'info').toString()
          const text = entry?.text ?? entry?.message ?? ''
          sinks.pushConsoleLog({
            timestamp: Number(entry?.timestamp) || Date.now(),
            type: chromeLogLevelToLogLevel(level) as LogLevel,
            args: [text],
            source: LOG_SOURCES.BROWSER
          })
        } catch (err) {
          log.warn(`onConsoleEntry handler threw: ${errorMessage(err)}`)
        }
      })
      await inspector.onJavascriptException((exception: any) => {
        try {
          const text =
            exception?.text ?? exception?.message ?? String(exception)
          const trimmed = String(text).replace(/\s+/g, ' ').slice(0, 200)
          log.warn(
            `🐛 JS error in page: ${trimmed}${String(text).length > 200 ? '…' : ''}`
          )
          sinks.pushConsoleLog({
            timestamp: Date.now(),
            type: 'error',
            args: [text],
            source: LOG_SOURCES.BROWSER
          })
        } catch (err) {
          log.warn(
            `onJavascriptException handler threw: ${errorMessage(err)}`
          )
        }
      })
      attached++
      log.info('✓ BiDi LogInspector attached (console + JS exceptions)')
    } catch (err) {
      log.warn(`BiDi LogInspector attach failed: ${errorMessage(err)}`)
    }
  } else {
    log.info('selenium-webdriver/bidi/logInspector not available — skipping')
  }

  if (typeof networkInspectorFactory === 'function') {
    try {
      const inspector = await networkInspectorFactory(driver)
      const pending = new Map<string, NetworkRequest>()

      await inspector.beforeRequestSent((event: any) => {
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
          log.warn(`beforeRequestSent threw: ${errorMessage(err)}`)
        }
      })

      await inspector.responseCompleted((event: any) => {
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
          log.warn(`responseCompleted threw: ${errorMessage(err)}`)
        }
      })

      attached++
      log.info('✓ BiDi NetworkInspector attached (request + response)')
    } catch (err) {
      log.warn(`BiDi NetworkInspector attach failed: ${errorMessage(err)}`)
    }
  } else {
    log.info(
      'selenium-webdriver/bidi/networkInspector not available — skipping'
    )
  }

  return attached > 0
}

// BiDi headers arrive as Array<{name, value:{value|type}}>; flatten to a
// lowercased dictionary.
function arrayHeadersToObject(
  headers: any
): Record<string, string> | undefined {
  if (!Array.isArray(headers)) {
    return undefined
  }
  const out: Record<string, string> = {}
  for (const h of headers) {
    const name = String(h?.name ?? '').toLowerCase()
    if (!name) {
      continue
    }
    const v = h?.value
    out[name] =
      typeof v === 'string'
        ? v
        : typeof v?.value === 'string'
          ? v.value
          : JSON.stringify(v ?? '')
  }
  return out
}

export function buildBidiSinks(capturer: SessionCapturer): BidiHandlerSinks {
  return {
    pushConsoleLog: (entry) => {
      capturer.consoleLogs.push(entry)
      capturer.sendUpstream('consoleLogs', [entry])
    },
    pushNetworkRequest: (entry) => {
      capturer.networkRequests.push(entry)
      capturer.sendUpstream('networkRequests', [entry])
    },
    replaceNetworkRequest: (id, entry) => {
      const idx = capturer.networkRequests.findIndex((r: any) => r.id === id)
      if (idx !== -1) {
        capturer.networkRequests[idx] = entry
      } else {
        capturer.networkRequests.push(entry)
      }
      capturer.sendUpstream('networkRequests', [entry])
    }
  }
}
