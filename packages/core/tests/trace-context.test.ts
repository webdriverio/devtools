import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const HEX_32 = /^[0-9a-f]{32}$/
const HEX_16 = /^[0-9a-f]{16}$/
const TRACE_ID = '0af7651916cd43dd8448eb211c80319c'
const SPAN_ID = 'b7ad6b7169203331'

describe('mintTraceContext', () => {
  it('mints lowercase hex ids of the W3C lengths', async () => {
    const { mintTraceContext } = await import('../src/trace-context.js')
    const ctx = mintTraceContext()
    expect(ctx.traceId).toMatch(HEX_32)
    expect(ctx.spanId).toMatch(HEX_16)
  })

  it('gives every mint its own ids', async () => {
    const { mintTraceContext } = await import('../src/trace-context.js')
    const a = mintTraceContext()
    const b = mintTraceContext()
    expect(a.traceId).not.toBe(b.traceId)
    expect(a.spanId).not.toBe(b.spanId)
  })

  it('joins a parent trace with a fresh span', async () => {
    const { mintTraceContext } = await import('../src/trace-context.js')
    const ctx = mintTraceContext({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceFlags: 0
    })
    expect(ctx.traceId).toBe(TRACE_ID)
    expect(ctx.spanId).not.toBe(SPAN_ID)
    expect(ctx.spanId).toMatch(HEX_16)
  })
})

describe('resolveParentTraceContext', () => {
  beforeEach(() => {
    delete process.env.TRACEPARENT
    delete process.env.TRACESTATE
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('is undefined when no TRACEPARENT is set', async () => {
    const { resolveParentTraceContext } =
      await import('../src/trace-context.js')
    expect(resolveParentTraceContext()).toBeUndefined()
  })

  it('reads TRACEPARENT and TRACESTATE', async () => {
    vi.stubEnv('TRACEPARENT', `00-${TRACE_ID}-${SPAN_ID}-01`)
    vi.stubEnv('TRACESTATE', 'vendor=1')
    const { resolveParentTraceContext } =
      await import('../src/trace-context.js')
    expect(resolveParentTraceContext()).toEqual({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceFlags: 1,
      traceState: 'vendor=1'
    })
  })

  it('warns once and ignores an invalid TRACEPARENT', async () => {
    const warn = vi.spyOn(process, 'emitWarning').mockImplementation(() => {})
    vi.stubEnv('TRACEPARENT', 'garbage')
    const { resolveParentTraceContext } =
      await import('../src/trace-context.js')
    expect(resolveParentTraceContext()).toBeUndefined()
    expect(resolveParentTraceContext()).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('reads the environment once per process', async () => {
    vi.stubEnv('TRACEPARENT', `00-${TRACE_ID}-${SPAN_ID}-01`)
    const { resolveParentTraceContext } =
      await import('../src/trace-context.js')
    const first = resolveParentTraceContext()
    vi.stubEnv('TRACEPARENT', `00-${'1'.repeat(32)}-${SPAN_ID}-01`)
    expect(resolveParentTraceContext()).toBe(first)
  })
})
