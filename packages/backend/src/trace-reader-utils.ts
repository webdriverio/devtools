// Pure helpers for reconstructing a player payload from trace.zip events.
// No I/O — the reader pipeline (trace-reader.ts) composes these.

import {
  TraceType,
  type ConsoleLog,
  type LogLevel,
  type Metadata,
  type NetworkRequest,
  type TracePlayerFrame,
  type Viewport
} from '@wdio/devtools-shared'

import { LOG_LEVEL_SET } from './trace-reader-constants.js'
import type {
  ConsoleEvent,
  ContextOptionsEvent,
  HarSnapshot,
  StdioEvent
} from './trace-reader-types.js'

export function parseNdjson(text: string): Record<string, unknown>[] {
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

// Reverse of buildActionEvents' params encoding: rebuild a positional args
// array from the semantic/indexed params object.
export function paramsToArgs(
  params: Record<string, unknown> | undefined
): unknown[] {
  if (!params) {
    return []
  }
  if ('selector' in params && 'value' in params) {
    return [params.selector, params.value]
  }
  if ('value' in params) {
    return [params.value]
  }
  if ('selector' in params) {
    return [params.selector]
  }
  if ('url' in params) {
    return [params.url]
  }
  const indexKeys = Object.keys(params)
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b))
  return indexKeys.map((key) => params[key])
}

// Trace-viewer action label, built from class.method + the most meaningful
// param (value for fill/type, url for navigate, nothing for click) —
// matching what standard trace viewers render for the same trace.
export function actionLabel(
  cls: string,
  method: string,
  params: Record<string, unknown> | undefined
): string {
  const base = `${cls}.${method}`
  if (params) {
    if ('value' in params) {
      return `${base}("${String(params.value)}")`
    }
    if ('url' in params) {
      return `${base}("${String(params.url)}")`
    }
    if ('selector' in params) {
      return `${base}("${String(params.selector)}")`
    }
  }
  return `${base}()`
}

function headerArrayToRecord(
  headers: { name: string; value: string }[] | undefined
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const header of headers ?? []) {
    out[header.name] = header.value
  }
  return out
}

// Coarse resource type from mime so the Network panel can group requests.
function mimeToType(mimeType: string): string {
  if (!mimeType) {
    return 'other'
  }
  if (mimeType.includes('html')) {
    return 'document'
  }
  if (mimeType.includes('javascript') || mimeType.includes('ecmascript')) {
    return 'script'
  }
  if (mimeType.includes('css')) {
    return 'stylesheet'
  }
  if (mimeType.startsWith('image/')) {
    return 'image'
  }
  if (mimeType.startsWith('font/') || mimeType.includes('font')) {
    return 'font'
  }
  if (mimeType.includes('json')) {
    return 'fetch'
  }
  return 'other'
}

export function harToNetworkRequest(
  snapshot: HarSnapshot,
  index: number
): NetworkRequest {
  const started = Date.parse(snapshot.startedDateTime)
  const startTime = Number.isFinite(started) ? started : 0
  // A foreign trace.zip (the reader accepts any standard-format zip) can carry
  // a pending or failed request with no response or content; default those.
  const response = snapshot.response
  const content = response?.content
  const responseHeaders = headerArrayToRecord(response?.headers)
  return {
    id: String(index),
    url: snapshot.request.url,
    method: snapshot.request.method,
    status: response?.status ?? 0,
    statusText: response?.statusText ?? '',
    timestamp: startTime,
    startTime,
    endTime: startTime + snapshot.time,
    time: snapshot.time,
    type: mimeToType(content?.mimeType ?? ''),
    requestHeaders: headerArrayToRecord(snapshot.request.headers),
    responseHeaders,
    size: content?.size ?? 0,
    response: {
      fromCache: false,
      headers: responseHeaders,
      mimeType: content?.mimeType ?? '',
      status: response?.status ?? 0
    }
  }
}

// Reverse level mapping; foreign levels outside our union default to 'log'.
function fromTraceLevel(messageType: string): LogLevel {
  if (messageType === 'warning') {
    return 'warn'
  }
  return LOG_LEVEL_SET.has(messageType) ? (messageType as LogLevel) : 'log'
}

export function buildConsoleLogs(
  consoleEvents: (ConsoleEvent | StdioEvent)[],
  wallTime: number
): ConsoleLog[] {
  return consoleEvents.map((event) => {
    if (event.type === 'console') {
      return {
        type: fromTraceLevel(event.messageType),
        args: event.args?.map((arg) => arg.value) ?? [event.text],
        timestamp: wallTime + event.time,
        source: 'browser' as const
      }
    }
    return {
      type: event.type === 'stderr' ? ('error' as const) : ('log' as const),
      args: [event.text ?? ''],
      timestamp: wallTime + event.timestamp,
      // Our zips carry the origin; foreign stdio events default to terminal.
      source: event.source ?? ('terminal' as const)
    }
  })
}

export function nearestFrame(
  frames: TracePlayerFrame[],
  timestamp: number
): TracePlayerFrame | undefined {
  let best: TracePlayerFrame | undefined
  let bestDelta = Infinity
  for (const frame of frames) {
    const delta = Math.abs(frame.timestamp - timestamp)
    if (delta < bestDelta) {
      bestDelta = delta
      best = frame
    }
  }
  return best
}

export function buildMetadata(ctx: ContextOptionsEvent | undefined): Metadata {
  const rawViewport = ctx?.options?.viewport ?? { width: 1280, height: 720 }
  const viewport: Viewport = {
    width: rawViewport.width,
    height: rawViewport.height,
    offsetLeft: 0,
    offsetTop: 0,
    scale: 1
  }
  const sessionId = ctx?.contextId?.split('@')[1]
  return {
    type: TraceType.Standalone,
    viewport,
    capabilities: ctx?.browserName
      ? { browserName: ctx.browserName }
      : undefined,
    ...(sessionId ? { sessionId } : {})
  }
}
