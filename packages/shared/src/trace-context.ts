/** W3C Trace Context (`traceparent`) for one test attempt. */
export interface TestTraceContext {
  /** 32 lowercase hex chars. */
  traceId: string
  /** 16 lowercase hex chars. */
  spanId: string
  traceFlags: number
}

/** A parent context read from `TRACEPARENT`, with the optional `TRACESTATE` it arrived with. */
export type ParentTraceContext = TestTraceContext & { traceState?: string }

export const TRACE_ID_BYTES = 16
export const SPAN_ID_BYTES = 8

export const TRACE_CONTEXT_ENV = {
  TRACEPARENT: 'TRACEPARENT',
  TRACESTATE: 'TRACESTATE'
} as const

const VERSION_RE = /^[0-9a-f]{2}$/
const TRACE_ID_RE = new RegExp(`^[0-9a-f]{${TRACE_ID_BYTES * 2}}$`)
const SPAN_ID_RE = new RegExp(`^[0-9a-f]{${SPAN_ID_BYTES * 2}}$`)
const FLAGS_RE = /^[0-9a-f]{2}$/
const ALL_ZERO_RE = /^0+$/
const INVALID_VERSION = 'ff'
const VERSION_00 = '00'

export function isTraceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    TRACE_ID_RE.test(value) &&
    !ALL_ZERO_RE.test(value)
  )
}

export function isSpanId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    SPAN_ID_RE.test(value) &&
    !ALL_ZERO_RE.test(value)
  )
}

/** Versions above `00` may append fields; `00` admits exactly four. */
export function parseTraceparent(
  header: string | undefined
): TestTraceContext | undefined {
  if (header === undefined) {
    return undefined
  }
  const [version, traceId, spanId, flags, ...extra] = header.split('-')
  if (
    version === undefined ||
    !VERSION_RE.test(version) ||
    version === INVALID_VERSION ||
    (version === VERSION_00 && extra.length > 0) ||
    !isTraceId(traceId) ||
    !isSpanId(spanId) ||
    !FLAGS_RE.test(flags ?? '')
  ) {
    return undefined
  }
  return {
    traceId: traceId!,
    spanId: spanId!,
    traceFlags: parseInt(flags!, 16)
  }
}

// Web Crypto, so this module stays usable in the browser. An all-zero id, the one invalid draw, has odds of 2^-64 or less.
function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes)
  globalThis.crypto.getRandomValues(buffer)
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
}

export function randomTraceId(): string {
  return randomHex(TRACE_ID_BYTES)
}

export function randomSpanId(): string {
  return randomHex(SPAN_ID_BYTES)
}
