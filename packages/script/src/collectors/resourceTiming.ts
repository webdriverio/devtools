import {
  getRequestType,
  NETWORK_CAPTURE_SOURCE,
  type NetworkTimings,
  type RequestType
} from '@wdio/devtools-shared'
import type { Collector } from './collector.js'
import type { NetworkRequest } from '../../types.js'
import { log } from '../logger.js'
import { shouldIgnoreRequest } from './network-helpers.js'

/** `responseStatus` is Resource Timing Level 2 (Chromium 109+); the lib types
 *  lag the spec, and Safari reports nothing here at all. */
type ResourceEntry = PerformanceResourceTiming & { responseStatus?: number }

/** Initiators whose load the parser issues itself, so the method is known.
 *  Anything else (a navigation, a fetch, a beacon) can carry a body, and
 *  Resource Timing does not say which method it used. */
const PARSER_INITIATORS = new Set([
  'img',
  'image',
  'input',
  'script',
  'css',
  'link',
  'video',
  'audio',
  'track',
  'use',
  'object',
  'embed',
  'icon'
])

const GET = 'GET'
const UNKNOWN_METHOD = ''

/** Whether the patched fetch/XHR collector holds this request; given the entry
 *  so it can hand it back if it drops the call. */
export type ClaimConsumer = (
  url: string,
  startTime: number,
  entry: NetworkRequest
) => boolean

function round(ms: number): number {
  return Math.max(0, Math.round(ms * 10) / 10)
}

/** The phases, when the response exposed them: a cross-origin resource without
 *  `Timing-Allow-Origin` reports every phase as zero, and zeros would read as
 *  an instantaneous handshake rather than as withheld. */
function timingsOf(entry: ResourceEntry): NetworkTimings | undefined {
  if (!(entry.requestStart > 0)) {
    return undefined
  }
  const lookupStart = entry.domainLookupStart || entry.fetchStart
  const timings: NetworkTimings = {
    blocked: round(lookupStart - entry.startTime),
    dns: round(entry.domainLookupEnd - entry.domainLookupStart),
    connect: round(entry.connectEnd - entry.connectStart),
    send: 0,
    wait: round(entry.responseStart - entry.requestStart),
    receive: round(entry.responseEnd - entry.responseStart)
  }
  if (entry.secureConnectionStart > 0) {
    timings.ssl = round(entry.connectEnd - entry.secureConnectionStart)
  }
  return timings
}

function classify(entry: ResourceEntry, isNavigation: boolean): RequestType {
  if (isNavigation) {
    return 'document'
  }
  switch (entry.initiatorType) {
    case 'navigation':
    case 'iframe':
    case 'frame':
      return 'document'
    case 'script':
      return 'script'
    case 'img':
    case 'image':
    case 'input':
      return 'image'
    case 'fetch':
    case 'beacon':
      return 'fetch'
    case 'xmlhttprequest':
      return 'xhr'
    default: {
      // A stylesheet's own loads (fonts, background images) and `<link>`s carry
      // no initiator worth a type; the extension says what they were. The
      // classifier's residual is `xhr`, which here would be a guess.
      const byUrl = getRequestType(entry.name)
      return byUrl === 'xhr' ? 'other' : byUrl
    }
  }
}

/**
 * Network capture from the document's own Resource Timing buffer: every load
 * the document made, on every browser, with or without WebDriver BiDi. It
 * holds what the patched `fetch`/`XMLHttpRequest` collector cannot see
 * (parser-initiated loads, and requests made before that collector existed)
 * and lacks what the patch has: headers, bodies, and outside Chromium the
 * status. Each row says so with `source`.
 */
export class ResourceTimingCollector implements Collector<NetworkRequest> {
  #requests: NetworkRequest[] = []
  #navigationRecorded = false
  readonly #consumeClaim: ClaimConsumer

  constructor(consumeClaim: ClaimConsumer) {
    this.#consumeClaim = consumeClaim
    this.#seed()
    this.#observe()
  }

  getArtifacts(): NetworkRequest[] {
    return this.#requests
  }

  clear(): void {
    this.#requests = []
  }

  /** What the buffer already holds: the loads before this collector existed.
   *  Read before observing, synchronously, so no entry falls between the two.
   *  Skipped on a document a previous collector already reported, or every
   *  load in the buffer would be listed again. */
  #seed(): void {
    if (
      typeof performance?.getEntriesByType !== 'function' ||
      typeof window.wdioTraceCollector !== 'undefined'
    ) {
      return
    }
    for (const entry of performance.getEntriesByType('navigation')) {
      this.#record(entry as ResourceEntry, true)
    }
    for (const entry of performance.getEntriesByType('resource')) {
      this.#record(entry as ResourceEntry, false)
    }
  }

  #observe(): void {
    if (typeof PerformanceObserver === 'undefined') {
      return
    }
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.#record(entry as ResourceEntry, entry.entryType === 'navigation')
        }
      })
      observer.observe({ entryTypes: ['resource', 'navigation'] })
    } catch (err) {
      log('Resource Timing observer refused; the buffer alone is captured', err)
    }
  }

  #record(entry: ResourceEntry, isNavigation: boolean): void {
    // A document has one navigation entry, complete only once it has loaded;
    // the observer delivers it then, and the seed may have read it earlier.
    if (isNavigation) {
      if (!(entry.responseEnd > 0) || this.#navigationRecorded) {
        return
      }
      this.#navigationRecorded = true
    }
    if (shouldIgnoreRequest(entry.name)) {
      return
    }
    const request = this.#toRequest(entry, isNavigation)
    // The patch saw this fetch/XHR with its method, headers and body; this
    // entry is the same request with none of them.
    if (
      (entry.initiatorType === 'fetch' ||
        entry.initiatorType === 'xmlhttprequest') &&
      this.#consumeClaim(entry.name, entry.startTime, request)
    ) {
      return
    }
    this.#requests.push(request)
  }

  #toRequest(entry: ResourceEntry, isNavigation: boolean): NetworkRequest {
    const timeOrigin =
      typeof performance.timeOrigin === 'number' && performance.timeOrigin > 0
        ? performance.timeOrigin
        : Date.now() - performance.now()
    const timestamp = Math.round(timeOrigin + entry.startTime)
    const status =
      typeof entry.responseStatus === 'number' && entry.responseStatus > 0
        ? entry.responseStatus
        : undefined
    // `transferSize` is zero for a cached response and for a cross-origin one
    // without `Timing-Allow-Origin`; the body sizes survive the first case.
    const size =
      entry.transferSize || entry.encodedBodySize || entry.decodedBodySize || 0
    const timings = timingsOf(entry)
    return {
      id: `rt-${timestamp}-${Math.random().toString(36).slice(2, 9)}`,
      url: entry.name,
      method: PARSER_INITIATORS.has(entry.initiatorType) ? GET : UNKNOWN_METHOD,
      ...(status !== undefined ? { status } : {}),
      type: classify(entry, isNavigation),
      timestamp,
      startTime: entry.startTime,
      endTime: entry.responseEnd,
      // Not `duration`: a navigation entry's runs to the load event, which is
      // the page's work rather than the response's.
      time: Math.max(0, entry.responseEnd - entry.startTime),
      ...(size > 0 ? { size } : {}),
      ...(timings ? { timings } : {}),
      source: NETWORK_CAPTURE_SOURCE.RESOURCE_TIMING
    }
  }
}
