import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as DevtoolsCore from '@wdio/devtools-core'
import {
  TraceSliceTracker,
  type TraceSliceContext
} from '../src/trace-slices.js'
import type { ServiceOptions } from '../src/types.js'

vi.mock('@wdio/devtools-core', async (importOriginal) => {
  const actual = await importOriginal<typeof DevtoolsCore>()
  return {
    ...actual,
    flushRangeLogged: vi
      .fn()
      .mockResolvedValue({ kind: 'trace', path: '/out/trace.zip' })
  }
})

const capturer = {
  commandsLog: [],
  consoleLogs: [],
  networkRequests: [],
  mutations: [],
  traceLogs: []
}

const browser = { sessionId: 'session-1' } as unknown as WebdriverIO.Browser
const exportContext = { granularity: 'test' } as unknown as ReturnType<
  TraceSliceContext['buildExportContext']
>

function makeTracker(
  options: ServiceOptions,
  overrides: Partial<TraceSliceContext> = {}
) {
  const ctx: TraceSliceContext = {
    options,
    getCapturer: () => capturer as never,
    getBrowser: () => browser,
    buildExportContext: () => exportContext,
    ...overrides
  }
  return new TraceSliceTracker(ctx)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TraceSliceTracker.recordBoundary', () => {
  it('records nothing without a spec file', () => {
    const tracker = makeTracker({ mode: 'trace', traceGranularity: 'test' })
    tracker.recordBoundary(undefined, 'uid-1')
    expect(tracker.ranges).toHaveLength(0)
  })

  it('session granularity records no slices', () => {
    const tracker = makeTracker({ mode: 'trace', traceGranularity: 'session' })
    tracker.recordBoundary('a.feature', 'uid-1')
    expect(tracker.ranges).toHaveLength(0)
  })

  it('test granularity records one slice per test, keyed per attempt', () => {
    const tracker = makeTracker({ mode: 'trace', traceGranularity: 'test' })
    tracker.recordBoundary('a.spec.ts', 'uid-1')
    tracker.recordBoundary('a.spec.ts', 'uid-1')
    expect(tracker.ranges.map((r) => r.key)).toEqual(['uid-1', 'uid-1-retry1'])
  })

  it('spec granularity flushes the previous, unflushed slice when the file changes', async () => {
    const tracker = makeTracker({ mode: 'trace', traceGranularity: 'spec' })
    tracker.recordBoundary('a.spec.ts')
    tracker.recordBoundary('a.spec.ts')
    const { flushRangeLogged } = await import('@wdio/devtools-core')
    expect(flushRangeLogged).not.toHaveBeenCalled()

    tracker.recordBoundary('b.spec.ts')
    expect(flushRangeLogged).toHaveBeenCalledWith(
      exportContext,
      expect.objectContaining({ key: 'a.spec.ts' })
    )
  })

  it('skips the previous-slice flush when no session is up', async () => {
    const tracker = makeTracker(
      { mode: 'trace', traceGranularity: 'spec' },
      { getBrowser: () => undefined }
    )
    tracker.recordBoundary('a.spec.ts')
    tracker.recordBoundary('b.spec.ts')
    const { flushRangeLogged } = await import('@wdio/devtools-core')
    expect(flushRangeLogged).not.toHaveBeenCalled()
  })
})

describe('TraceSliceTracker.flushTest', () => {
  it('flushes the ending test its own slice and returns the artifact', async () => {
    const tracker = makeTracker({ mode: 'trace', traceGranularity: 'test' })
    tracker.recordBoundary('a.spec.ts', 'uid-1')

    await expect(tracker.flushTest('uid-1')).resolves.toEqual({
      kind: 'trace',
      path: '/out/trace.zip'
    })
  })

  it('flushes the latest attempt of a retried test', async () => {
    const tracker = makeTracker({ mode: 'trace', traceGranularity: 'test' })
    tracker.recordBoundary('a.spec.ts', 'uid-1')
    tracker.recordBoundary('a.spec.ts', 'uid-1')
    await tracker.flushTest('uid-1')

    const { flushRangeLogged } = await import('@wdio/devtools-core')
    expect(flushRangeLogged).toHaveBeenLastCalledWith(
      exportContext,
      expect.objectContaining({ key: 'uid-1-retry1' })
    )
  })

  it.each([
    ['spec granularity', { mode: 'trace', traceGranularity: 'spec' }],
    ['live mode', { mode: 'live', traceGranularity: 'test' }]
  ])('is a no-op under %s', async (_name, options) => {
    const tracker = makeTracker(options as ServiceOptions)
    tracker.recordBoundary('a.spec.ts', 'uid-1')
    await expect(tracker.flushTest('uid-1')).resolves.toBeUndefined()
  })

  it('is a no-op for a test that recorded no range', async () => {
    const tracker = makeTracker({ mode: 'trace', traceGranularity: 'test' })
    await expect(tracker.flushTest('never-started')).resolves.toBeUndefined()
  })
})
