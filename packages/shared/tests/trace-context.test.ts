import { describe, expect, it } from 'vitest'
import {
  isSpanId,
  isTraceId,
  parseTraceparent,
  randomSpanId,
  randomTraceId,
  TRACE_CONTEXT_ENV
} from '../src/trace-context.js'

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c'
const SPAN_ID = 'b7ad6b7169203331'
const VALID = `00-${TRACE_ID}-${SPAN_ID}-01`

describe('traceparent', () => {
  it('reads the flags of an unsampled header as 0', () => {
    expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-00`)?.traceFlags).toBe(0)
  })

  it('parses a valid version-00 header', () => {
    expect(parseTraceparent(VALID)).toEqual({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceFlags: 1
    })
  })

  it('accepts a higher version that appends fields', () => {
    expect(parseTraceparent(`01-${TRACE_ID}-${SPAN_ID}-01-extra`)).toEqual({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceFlags: 1
    })
  })

  it('rejects version 00 with trailing fields', () => {
    expect(parseTraceparent(`${VALID}-extra`)).toBeUndefined()
  })

  it('rejects wrong lengths', () => {
    expect(
      parseTraceparent(`00-${TRACE_ID.slice(1)}-${SPAN_ID}-01`)
    ).toBeUndefined()
    expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}0-01`)).toBeUndefined()
    expect(parseTraceparent(`00-${TRACE_ID}-${SPAN_ID}-1`)).toBeUndefined()
  })

  it('rejects uppercase hex', () => {
    expect(
      parseTraceparent(`00-${TRACE_ID.toUpperCase()}-${SPAN_ID}-01`)
    ).toBeUndefined()
  })

  it('rejects all-zero trace and span ids', () => {
    expect(
      parseTraceparent(`00-${'0'.repeat(32)}-${SPAN_ID}-01`)
    ).toBeUndefined()
    expect(
      parseTraceparent(`00-${TRACE_ID}-${'0'.repeat(16)}-01`)
    ).toBeUndefined()
  })

  it('rejects version ff and non-hex versions', () => {
    expect(parseTraceparent(`ff-${TRACE_ID}-${SPAN_ID}-01`)).toBeUndefined()
    expect(parseTraceparent(`zz-${TRACE_ID}-${SPAN_ID}-01`)).toBeUndefined()
  })

  it('treats undefined and garbage as no context', () => {
    expect(parseTraceparent(undefined)).toBeUndefined()
    expect(parseTraceparent('')).toBeUndefined()
    expect(parseTraceparent('not-a-header')).toBeUndefined()
  })

  it('names the env vars the context travels in', () => {
    expect(TRACE_CONTEXT_ENV).toEqual({
      TRACEPARENT: 'TRACEPARENT',
      TRACESTATE: 'TRACESTATE'
    })
  })
})

describe('random ids', () => {
  it('draws valid, distinct trace and span ids', () => {
    const traceIds = new Set(Array.from({ length: 50 }, randomTraceId))
    const spanIds = new Set(Array.from({ length: 50 }, randomSpanId))
    expect(traceIds.size).toBe(50)
    expect(spanIds.size).toBe(50)
    expect([...traceIds].every(isTraceId)).toBe(true)
    expect([...spanIds].every(isSpanId)).toBe(true)
  })
})
