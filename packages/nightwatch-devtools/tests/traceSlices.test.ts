import { describe, it, expect, vi } from 'vitest'
import type { SpecRange, TraceArtifact } from '@wdio/devtools-core'
import {
  recordTestSliceBoundary,
  recordSpecSliceBoundary,
  flushTestSlice,
  type TestSliceCtx
} from '../src/trace-slices.js'
import type { SessionCapturer } from '../src/session.js'
import type { TraceGranularity } from '../src/types.js'

function makeCtx(traceMode: boolean, granularity: TraceGranularity) {
  const capturer = {
    commandsLog: [],
    consoleLogs: [],
    networkRequests: [],
    mutations: [],
    traceLogs: [],
    actionSnapshots: []
  } as unknown as SessionCapturer
  const artifacts: TraceArtifact[] = []
  const flushTraceRange = vi.fn(
    async (range: SpecRange): Promise<TraceArtifact> => {
      const artifact: TraceArtifact = {
        kind: 'trace',
        path: `/out/${range.key}.zip`,
        scope: range.testUid ? 'test' : 'spec',
        key: range.key,
        testUids: range.testUid ? [range.testUid] : [],
        retained: true
      }
      artifacts.push(artifact)
      return artifact
    }
  )
  const ctx: TestSliceCtx = {
    sessionCapturer: capturer,
    traceMode,
    traceGranularity: granularity,
    specRanges: [],
    flushedSpecs: new Set<string>(),
    flushTraceRange
  }
  return { ctx, artifacts, flushTraceRange }
}

describe('test granularity — recordTestSliceBoundary', () => {
  it('records a per-test slice keyed on the test uid', () => {
    const { ctx } = makeCtx(true, 'test')
    recordTestSliceBoundary(ctx, '/login.spec.js', 'uid-1')
    expect(ctx.specRanges).toHaveLength(1)
    expect(ctx.specRanges[0]).toMatchObject({
      key: 'uid-1',
      testUid: 'uid-1',
      specFile: '/login.spec.js'
    })
  })

  it('keys a retry of the same test as a distinct slice', () => {
    const { ctx } = makeCtx(true, 'test')
    recordTestSliceBoundary(ctx, '/a.spec.js', 'uid-1')
    recordTestSliceBoundary(ctx, '/a.spec.js', 'uid-1') // retry
    recordTestSliceBoundary(ctx, '/a.spec.js', 'uid-2') // sibling test
    expect(ctx.specRanges.map((r) => r.key)).toEqual([
      'uid-1',
      'uid-1-retry1',
      'uid-2'
    ])
    // Every slice stays a test slice (base uid preserved for metadata filter).
    expect(ctx.specRanges.map((r) => r.testUid)).toEqual([
      'uid-1',
      'uid-1',
      'uid-2'
    ])
  })
})

describe('test granularity — flushTestSlice', () => {
  it('emits one artifact per test slice, flushing the current test at its end', () => {
    const { ctx, artifacts, flushTraceRange } = makeCtx(true, 'test')
    recordTestSliceBoundary(ctx, '/a.spec.js', 'uid-1')
    flushTestSlice(ctx)
    recordTestSliceBoundary(ctx, '/a.spec.js', 'uid-2')
    flushTestSlice(ctx)

    expect(flushTraceRange).toHaveBeenCalledTimes(2)
    expect(artifacts.map((a) => a.key)).toEqual(['uid-1', 'uid-2'])
    expect(artifacts.every((a) => a.scope === 'test')).toBe(true)
  })

  it('flushes each attempt separately so retries become distinct artifacts', () => {
    const { ctx, artifacts } = makeCtx(true, 'test')
    recordTestSliceBoundary(ctx, '/a.spec.js', 'uid-1')
    flushTestSlice(ctx) // attempt 0 flushed before the retry can overwrite it
    recordTestSliceBoundary(ctx, '/a.spec.js', 'uid-1')
    flushTestSlice(ctx) // attempt 1

    expect(artifacts.map((a) => a.key)).toEqual(['uid-1', 'uid-1-retry1'])
  })

  it('does nothing when there is no recorded slice', () => {
    const { ctx, flushTraceRange } = makeCtx(true, 'test')
    flushTestSlice(ctx)
    expect(flushTraceRange).not.toHaveBeenCalled()
  })
})

describe('test-slice helpers are inert outside trace + test granularity', () => {
  it('no-ops for spec and session granularity', () => {
    for (const granularity of ['spec', 'session'] as TraceGranularity[]) {
      const { ctx, flushTraceRange } = makeCtx(true, granularity)
      recordTestSliceBoundary(ctx, '/a.spec.js', 'uid-1')
      flushTestSlice(ctx)
      expect(ctx.specRanges).toHaveLength(0)
      expect(flushTraceRange).not.toHaveBeenCalled()
    }
  })

  it('no-ops in live mode even at test granularity', () => {
    const { ctx, flushTraceRange } = makeCtx(false, 'test')
    recordTestSliceBoundary(ctx, '/a.spec.js', 'uid-1')
    flushTestSlice(ctx)
    expect(ctx.specRanges).toHaveLength(0)
    expect(flushTraceRange).not.toHaveBeenCalled()
  })
})

describe('spec granularity is unchanged by the test-slice work', () => {
  it('records one slice per spec file and flushes the previous on transition', () => {
    const { ctx, artifacts, flushTraceRange } = makeCtx(true, 'spec')
    recordSpecSliceBoundary(ctx, '/a.spec.js')
    expect(ctx.specRanges.map((r) => r.key)).toEqual(['/a.spec.js'])
    expect(flushTraceRange).not.toHaveBeenCalled() // no previous spec yet

    recordSpecSliceBoundary(ctx, '/a.spec.js') // same spec → shared slice
    expect(ctx.specRanges).toHaveLength(1)

    recordSpecSliceBoundary(ctx, '/b.spec.js') // new spec → flush previous
    expect(ctx.specRanges.map((r) => r.key)).toEqual([
      '/a.spec.js',
      '/b.spec.js'
    ])
    expect(artifacts.map((a) => a.key)).toEqual(['/a.spec.js'])
    expect(artifacts[0].scope).toBe('spec')
  })

  it('records nothing for session or test granularity', () => {
    for (const granularity of ['session', 'test'] as TraceGranularity[]) {
      const { ctx, flushTraceRange } = makeCtx(true, granularity)
      recordSpecSliceBoundary(ctx, '/a.spec.js')
      expect(ctx.specRanges).toHaveLength(0)
      expect(flushTraceRange).not.toHaveBeenCalled()
    }
  })
})
