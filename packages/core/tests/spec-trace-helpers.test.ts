import { describe, it, expect } from 'vitest'
import {
  buildSpecCapturer,
  buildSpecSessionId,
  buildTestSliceSessionId,
  filterTestMetadataBySpec,
  filterTestMetadataByUid,
  recordSliceBoundary,
  recordSpecBoundary,
  sanitizeSpecName,
  type SpecBoundaryContext,
  type SpecRange,
  type TraceCapturer
} from '@wdio/devtools-core'
import { TraceType, type TestMetadataMap } from '@wdio/devtools-shared'

function capturer(): TraceCapturer {
  const cmd = (i: number) => ({
    command: 'url',
    args: [String(i)],
    timestamp: i,
    startTime: i
  })
  return {
    mutations: [{ m: 0 }, { m: 1 }, { m: 2 }] as never,
    traceLogs: ['t0', 't1', 't2'],
    consoleLogs: [{ c: 0 }, { c: 1 }, { c: 2 }] as never,
    networkRequests: [{ n: 0 }, { n: 1 }, { n: 2 }] as never,
    commandsLog: [cmd(0), cmd(1), cmd(2), cmd(3)],
    sources: new Map([['/a.js', 'source']]),
    metadata: { type: TraceType.Standalone },
    startWallTime: 0
  }
}

const range = (over: Partial<SpecRange> = {}): SpecRange => ({
  specFile: '/a.js',
  key: over.key ?? over.specFile ?? '/a.js',
  commandStartIdx: 0,
  consoleStartIdx: 0,
  networkStartIdx: 0,
  mutationStartIdx: 0,
  traceLogStartIdx: 0,
  snapshotCount: 0,
  ...over
})

function boundaryCtx(
  over: Partial<SpecBoundaryContext> = {}
): SpecBoundaryContext {
  return {
    specRanges: [],
    flushedSpecs: new Set(),
    capturer: {
      commandsLog: [],
      consoleLogs: [],
      networkRequests: [],
      mutations: [],
      traceLogs: []
    },
    actionSnapshots: [],
    ...over
  }
}

describe('buildSpecCapturer', () => {
  it('slices from the range start to the end when no nextRange is given', () => {
    const sliced = buildSpecCapturer(capturer(), range({ commandStartIdx: 2 }))
    expect(sliced.commandsLog).toHaveLength(2)
    expect(sliced.commandsLog.map((c) => c.args[0])).toEqual(['2', '3'])
  })

  it('slices to nextRange start indices when provided', () => {
    const sliced = buildSpecCapturer(
      capturer(),
      range({ commandStartIdx: 1, consoleStartIdx: 1 }),
      range({ commandStartIdx: 3, consoleStartIdx: 2 })
    )
    expect(sliced.commandsLog.map((c) => c.args[0])).toEqual(['1', '2'])
    expect(sliced.consoleLogs).toHaveLength(1)
  })

  it('clones the source map so later parent mutations do not leak in', () => {
    const parent = capturer()
    const sliced = buildSpecCapturer(parent, range())
    parent.sources.set('/b.js', 'added-later')
    expect(sliced.sources.has('/b.js')).toBe(false)
  })
})

describe('filterTestMetadataBySpec', () => {
  it('keeps only entries whose specFile matches', () => {
    const all: TestMetadataMap = new Map([
      ['u1', { title: 'A', specFile: '/a.js' }],
      ['u2', { title: 'B', specFile: '/b.js' }],
      ['u3', { title: 'C', specFile: '/a.js' }]
    ])
    const filtered = filterTestMetadataBySpec(all, '/a.js')
    expect([...filtered.keys()]).toEqual(['u1', 'u3'])
  })
})

describe('spec name / session id', () => {
  it('sanitizes unsafe characters and falls back to unknown-spec', () => {
    expect(sanitizeSpecName('/tests/login flow.ts')).toBe('login_flow')
    expect(sanitizeSpecName('/specs/login.spec.ts')).toBe('login_spec')
    expect(sanitizeSpecName('....')).toBe('unknown-spec')
  })

  it('derives a stable, collision-resistant spec session id', () => {
    const a = buildSpecSessionId('/dir1/login.js', 'session-xyz')
    const b = buildSpecSessionId('/dir2/login.js', 'session-xyz')
    expect(a).not.toBe(b)
    expect(a).toBe(buildSpecSessionId('/dir1/login.js', 'session-xyz'))
    expect(a.startsWith('login-')).toBe(true)
  })
})

describe('filterTestMetadataByUid', () => {
  it('keeps only the entry for the given uid', () => {
    const all: TestMetadataMap = new Map([
      ['u1', { title: 'A', specFile: '/a.js' }],
      ['u2', { title: 'B', specFile: '/b.js' }]
    ])
    expect([...filterTestMetadataByUid(all, 'u1').keys()]).toEqual(['u1'])
    expect(filterTestMetadataByUid(all, 'missing').size).toBe(0)
  })
})

describe('buildTestSliceSessionId', () => {
  it('derives distinct, stable ids per key and stays readable', () => {
    const a = buildTestSliceSessionId('/dir/login.js', 'u1', 'session-xyz')
    const b = buildTestSliceSessionId('/dir/login.js', 'u2', 'session-xyz')
    const retry = buildTestSliceSessionId(
      '/dir/login.js',
      'u1-retry1',
      'session-xyz'
    )
    expect(a).not.toBe(b)
    expect(a).not.toBe(retry)
    expect(a).toBe(
      buildTestSliceSessionId('/dir/login.js', 'u1', 'session-xyz')
    )
    expect(a.startsWith('login-')).toBe(true)
  })
})

describe('recordSliceBoundary (test granularity)', () => {
  it('opens a new slice per test uid and returns the previous range', () => {
    const ctx = boundaryCtx({
      capturer: {
        commandsLog: [1, 2],
        consoleLogs: [1],
        networkRequests: [],
        mutations: [1, 2, 3],
        traceLogs: []
      },
      actionSnapshots: [1, 1]
    })
    expect(recordSliceBoundary(ctx, 'test', '/a.js', 'u1')).toBeNull()
    expect(ctx.specRanges).toHaveLength(1)
    expect(ctx.specRanges[0]!.key).toBe('u1')
    expect(ctx.specRanges[0]!.testUid).toBe('u1')
    expect(ctx.specRanges[0]!.commandStartIdx).toBe(2)
    expect(ctx.specRanges[0]!.snapshotCount).toBe(2)

    const prev = recordSliceBoundary(ctx, 'test', '/a.js', 'u2')
    expect(prev?.key).toBe('u1')
    expect(ctx.specRanges).toHaveLength(2)
    expect(ctx.specRanges[1]!.key).toBe('u2')
  })

  it('keys each retry of the same uid as its own slice', () => {
    const ctx = boundaryCtx()
    recordSliceBoundary(ctx, 'test', '/a.js', 'u1')
    recordSliceBoundary(ctx, 'test', '/a.js', 'u1')
    recordSliceBoundary(ctx, 'test', '/a.js', 'u1')
    expect(ctx.specRanges.map((r) => r.key)).toEqual([
      'u1',
      'u1-retry1',
      'u1-retry2'
    ])
    expect(ctx.specRanges.every((r) => r.testUid === 'u1')).toBe(true)
  })

  it('returns null when no testUid is provided', () => {
    const ctx = boundaryCtx()
    expect(recordSliceBoundary(ctx, 'test', '/a.js')).toBeNull()
    expect(ctx.specRanges).toHaveLength(0)
  })

  it('does not return a previous range already in the flushed set', () => {
    const ctx = boundaryCtx()
    recordSliceBoundary(ctx, 'test', '/a.js', 'u1')
    ctx.flushedSpecs.add('u1')
    expect(recordSliceBoundary(ctx, 'test', '/a.js', 'u2')).toBeNull()
  })
})

describe('recordSliceBoundary / recordSpecBoundary (spec granularity)', () => {
  it('keeps the spec-file behavior: one slice per spec, key equals specFile', () => {
    const ctx = boundaryCtx()
    expect(recordSliceBoundary(ctx, 'spec', '/a.js')).toBeNull()
    expect(recordSliceBoundary(ctx, 'spec', '/a.js')).toBeNull()
    expect(ctx.specRanges).toHaveLength(1)
    expect(ctx.specRanges[0]!.key).toBe('/a.js')
    expect(ctx.specRanges[0]!.testUid).toBeUndefined()

    const prev = recordSliceBoundary(ctx, 'spec', '/b.js')
    expect(prev?.specFile).toBe('/a.js')
    expect(ctx.specRanges).toHaveLength(2)
  })

  it('recordSpecBoundary returns null for session and test granularities', () => {
    expect(recordSpecBoundary(boundaryCtx(), '/a.js', 'session')).toBeNull()
    expect(recordSpecBoundary(boundaryCtx(), '/a.js', 'test')).toBeNull()
    const ctx = boundaryCtx()
    recordSpecBoundary(ctx, '/a.js', 'spec')
    expect(ctx.specRanges).toHaveLength(1)
    expect(ctx.specRanges[0]!.key).toBe('/a.js')
  })
})
