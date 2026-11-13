import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RUNNER_ENV } from '@wdio/devtools-shared'

const HEX_32 = /^[0-9a-f]{32}$/
const HEX_16 = /^[0-9a-f]{16}$/
const TRACE_ID = '0af7651916cd43dd8448eb211c80319c'
const SPAN_ID = 'b7ad6b7169203331'
const RUN_ID = '0AF76519-16CD-43DD-8448-EB211C80319C'
const OTHER_RUN_ID = '5f3e1c2a-9b8d-4e7f-a1b2-c3d4e5f60718'
const UID = 'suite > test'
const OTHER_UID = 'suite > other test'

describe('mintTraceContext', () => {
  it('mints lowercase hex ids of the W3C lengths', async () => {
    const { mintTraceContext } = await import('../src/trace-context.js')
    const ctx = mintTraceContext(UID)
    expect(ctx.traceId).toMatch(HEX_32)
    expect(ctx.spanId).toMatch(HEX_16)
  })

  describe('with a run id', () => {
    beforeEach(() => {
      vi.stubEnv(RUNNER_ENV.RUN_ID, RUN_ID)
    })
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('gives every attempt of one test the same trace, with its own span', async () => {
      const { mintTraceContext } = await import('../src/trace-context.js')
      const a = mintTraceContext(UID)
      const b = mintTraceContext(UID)
      expect(b.traceId).toBe(a.traceId)
      expect(a.spanId).not.toBe(b.spanId)
    })

    it('gives two different tests their own traces', async () => {
      const { mintTraceContext } = await import('../src/trace-context.js')
      const a = mintTraceContext(UID)
      const b = mintTraceContext(OTHER_UID)
      expect(b.traceId).not.toBe(a.traceId)
    })

    it('gives a different run its own trace', async () => {
      const { mintTraceContext } = await import('../src/trace-context.js')
      const first = mintTraceContext(UID)
      vi.stubEnv(RUNNER_ENV.RUN_ID, OTHER_RUN_ID)
      const second = mintTraceContext(UID)
      expect(second.traceId).not.toBe(first.traceId)
    })

    it('still joins a parent trace over the test trace', async () => {
      const { mintTraceContext } = await import('../src/trace-context.js')
      const ctx = mintTraceContext(UID, {
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        traceFlags: 0
      })
      expect(ctx.traceId).toBe(TRACE_ID)
    })
  })

  it('joins a parent trace with a fresh span', async () => {
    const { mintTraceContext } = await import('../src/trace-context.js')
    const ctx = mintTraceContext(UID, {
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceFlags: 0
    })
    expect(ctx.traceId).toBe(TRACE_ID)
    expect(ctx.spanId).not.toBe(SPAN_ID)
    expect(ctx.spanId).toMatch(HEX_16)
  })
})

describe('testTraceId', () => {
  it('is 32 lower-case hex digits', async () => {
    const { testTraceId } = await import('../src/trace-context.js')
    expect(testTraceId(RUN_ID, UID)).toMatch(HEX_32)
  })

  it('is stable for the same run id and uid', async () => {
    const { testTraceId } = await import('../src/trace-context.js')
    expect(testTraceId('run-a', UID)).toBe(testTraceId('run-a', UID))
  })

  it('differs when the run id differs', async () => {
    const { testTraceId } = await import('../src/trace-context.js')
    expect(testTraceId('run-a', UID)).not.toBe(testTraceId('run-b', UID))
  })

  it('differs when the uid differs', async () => {
    const { testTraceId } = await import('../src/trace-context.js')
    expect(testTraceId('run-a', UID)).not.toBe(testTraceId('run-a', OTHER_UID))
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
