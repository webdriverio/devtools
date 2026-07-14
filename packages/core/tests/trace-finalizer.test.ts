import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildSpecSessionId,
  buildTestSliceFolder,
  finalizeTraceExport,
  flushRangeTrace,
  TestAttemptTracker,
  type SpecRange,
  type TraceArtifact,
  type TraceCapturer,
  type TraceExportContext
} from '@wdio/devtools-core'
import {
  TraceType,
  type TestMetadataEntry,
  type TestMetadataMap
} from '@wdio/devtools-shared'

function makeCapturer(commandCount = 4): TraceCapturer {
  return {
    mutations: [],
    traceLogs: [],
    consoleLogs: [],
    networkRequests: [],
    commandsLog: Array.from({ length: commandCount }, (_, i) => ({
      command: 'url',
      args: [`https://example.test/${i}`],
      timestamp: 1000 + i * 100,
      startTime: 1000 + i * 100 - 50
    })),
    sources: new Map(),
    metadata: {
      type: TraceType.Standalone,
      viewport: {
        width: 800,
        height: 600,
        offsetLeft: 0,
        offsetTop: 0,
        scale: 1
      }
    },
    startWallTime: 1000
  }
}

function meta(entries: Array<[string, TestMetadataEntry]>): TestMetadataMap {
  return new Map(entries)
}

function range(specFile: string, startIdx: number): SpecRange {
  return {
    specFile,
    key: specFile,
    commandStartIdx: startIdx,
    consoleStartIdx: 0,
    networkStartIdx: 0,
    mutationStartIdx: 0,
    traceLogStartIdx: 0,
    snapshotCount: 0
  }
}

function testRange(
  specFile: string,
  testUid: string,
  startIdx: number,
  key = testUid
): SpecRange {
  return { ...range(specFile, startIdx), key, testUid }
}

describe('finalizeTraceExport', () => {
  let outputDir: string
  let artifacts: TraceArtifact[]
  let logs: Array<[string, string]>

  beforeEach(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-finalizer-'))
    artifacts = []
    logs = []
  })
  afterEach(async () => {
    await fs.rm(outputDir, { recursive: true, force: true })
  })

  function baseCtx(
    overrides: Partial<TraceExportContext> = {}
  ): TraceExportContext {
    return {
      mode: 'trace',
      granularity: 'session',
      format: 'zip',
      capturer: makeCapturer(),
      actionSnapshots: [],
      sessionId: 'abcd1234',
      testMetadata: new Map(),
      ranges: [],
      flushed: new Set(),
      resolveOutputDir: () => outputDir,
      log: (level, msg) => logs.push([level, msg]),
      onArtifact: (a) => artifacts.push(a),
      ...overrides
    }
  }

  const exists = (p: string) =>
    fs.access(p).then(
      () => true,
      () => false
    )

  it('is a no-op outside trace mode', async () => {
    const result = await finalizeTraceExport(baseCtx({ mode: 'live' }))
    expect(result).toEqual([])
    expect(await fs.readdir(outputDir)).toEqual([])
  })

  it('writes one session-level trace for session granularity', async () => {
    const result = await finalizeTraceExport(
      baseCtx({
        testMetadata: meta([['u1', { title: 'T1', specFile: '/a.js' }]])
      })
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.scope).toBe('session')
    expect(result[0]!.retained).toBe(true)
    expect(result[0]!.testUids).toEqual(['u1'])
    expect(await exists(path.join(outputDir, 'trace-abcd1234.zip'))).toBe(true)
    expect(artifacts).toHaveLength(1)
  })

  it('fans out one trace per recorded spec range', async () => {
    const result = await finalizeTraceExport(
      baseCtx({
        granularity: 'spec',
        ranges: [range('/a.js', 0), range('/b.js', 2)],
        testMetadata: meta([
          ['a1', { title: 'A1', specFile: '/a.js' }],
          ['b1', { title: 'B1', specFile: '/b.js' }]
        ])
      })
    )
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.scope)).toEqual(['spec', 'spec'])
    expect(result.map((a) => a.key)).toEqual(['/a.js', '/b.js'])
    // testUids filtered to each spec's own tests.
    expect(result[0]!.testUids).toEqual(['a1'])
    expect(result[1]!.testUids).toEqual(['b1'])
    const nameA = buildSpecSessionId('/a.js', 'abcd1234')
    const nameB = buildSpecSessionId('/b.js', 'abcd1234')
    expect(await exists(path.join(outputDir, `trace-${nameA}.zip`))).toBe(true)
    expect(await exists(path.join(outputDir, `trace-${nameB}.zip`))).toBe(true)
  })

  it('warns and falls back to a session trace when spec has no boundaries', async () => {
    const result = await finalizeTraceExport(
      baseCtx({ granularity: 'spec', ranges: [] })
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.scope).toBe('session')
    expect(await exists(path.join(outputDir, 'trace-abcd1234.zip'))).toBe(true)
    expect(
      logs.some(
        ([level, msg]) =>
          level === 'warn' && msg.includes('no spec boundaries were detected')
      )
    ).toBe(true)
  })

  it('fans out one trace per recorded test range', async () => {
    const result = await finalizeTraceExport(
      baseCtx({
        granularity: 'test',
        ranges: [testRange('/a.js', 'a1', 0), testRange('/a.js', 'a2', 2)],
        testMetadata: meta([
          ['a1', { title: 'A1', specFile: '/a.js' }],
          ['a2', { title: 'A2', specFile: '/a.js' }]
        ])
      })
    )
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.scope)).toEqual(['test', 'test'])
    expect(result.map((a) => a.key)).toEqual(['a1', 'a2'])
    // Each test slice carries only its own test's metadata.
    expect(result[0]!.testUids).toEqual(['a1'])
    expect(result[1]!.testUids).toEqual(['a2'])
    // Each slice lands in its own <spec>--<title>-<browser>/trace.zip folder.
    const folderA1 = buildTestSliceFolder('/a.js', 'A1', undefined, 'a1')
    const folderA2 = buildTestSliceFolder('/a.js', 'A2', undefined, 'a2')
    expect(folderA1).not.toBe(folderA2)
    expect(result[0]!.path).toBe(path.join(outputDir, folderA1, 'trace.zip'))
    expect(await exists(path.join(outputDir, folderA1, 'trace.zip'))).toBe(true)
    expect(await exists(path.join(outputDir, folderA2, 'trace.zip'))).toBe(true)
  })

  it('treats a retry-keyed range as its own test slice', async () => {
    const result = await finalizeTraceExport(
      baseCtx({
        granularity: 'test',
        ranges: [
          testRange('/a.js', 'a1', 0),
          testRange('/a.js', 'a1', 2, 'a1-retry1')
        ],
        testMetadata: meta([['a1', { title: 'A1', specFile: '/a.js' }]])
      })
    )
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.key)).toEqual(['a1', 'a1-retry1'])
    // The retry attempt gets a distinct folder via the -retry<N> suffix.
    const first = buildTestSliceFolder('/a.js', 'A1', undefined, 'a1')
    const retry = buildTestSliceFolder('/a.js', 'A1', undefined, 'a1-retry1')
    expect(first).not.toBe(retry)
    expect(retry.endsWith('-retry1')).toBe(true)
    expect(await exists(path.join(outputDir, first, 'trace.zip'))).toBe(true)
    expect(await exists(path.join(outputDir, retry, 'trace.zip'))).toBe(true)
  })

  it('warns and falls back to a session trace when test has no boundaries', async () => {
    const result = await finalizeTraceExport(
      baseCtx({ granularity: 'test', ranges: [] })
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.scope).toBe('session')
    expect(await exists(path.join(outputDir, 'trace-abcd1234.zip'))).toBe(true)
    expect(
      logs.some(
        ([level, msg]) =>
          level === 'warn' && msg.includes('no test boundaries were detected')
      )
    ).toBe(true)
  })

  it('warns to pair with a retention policy above the slice-count threshold', async () => {
    const ranges = Array.from({ length: 201 }, (_, i) =>
      testRange('/a.js', `u${i}`, i)
    )
    const result = await finalizeTraceExport(
      baseCtx({
        granularity: 'test',
        // retain-on-failure + all-passing declines every write, so the guard
        // is exercised without emitting 201 archives.
        policy: 'retain-on-failure',
        ranges,
        testMetadata: meta(
          ranges.map((r) => [
            r.testUid!,
            {
              title: r.testUid!,
              specFile: '/a.js',
              state: 'passed',
              attempt: 0
            }
          ])
        )
      })
    )
    expect(result).toHaveLength(201)
    expect(result.every((a) => !a.retained)).toBe(true)
    expect(await fs.readdir(outputDir)).toEqual([])
    expect(
      logs.some(
        ([level, msg]) => level === 'warn' && msg.includes('retention policy')
      )
    ).toBe(true)
  })

  it('does not rewrite a range already in the flushed set', async () => {
    const flushed = new Set<string>(['/a.js'])
    const result = await finalizeTraceExport(
      baseCtx({
        granularity: 'spec',
        ranges: [range('/a.js', 0), range('/b.js', 2)],
        flushed,
        testMetadata: meta([['b1', { title: 'B1', specFile: '/b.js' }]])
      })
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.key).toBe('/b.js')
    const nameA = buildSpecSessionId('/a.js', 'abcd1234')
    expect(await exists(path.join(outputDir, `trace-${nameA}.zip`))).toBe(false)
  })

  it('catches a failing write and still writes the remaining ranges', async () => {
    const result = await finalizeTraceExport(
      baseCtx({
        granularity: 'spec',
        ranges: [range('/a.js', 0), range('/b.js', 2)],
        resolveOutputDir: (r) => {
          if (r?.specFile === '/a.js') {
            throw new Error('boom')
          }
          return outputDir
        }
      })
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.key).toBe('/b.js')
    expect(
      logs.some(([lvl, msg]) => lvl === 'warn' && msg.includes('boom'))
    ).toBe(true)
    const nameB = buildSpecSessionId('/b.js', 'abcd1234')
    expect(await exists(path.join(outputDir, `trace-${nameB}.zip`))).toBe(true)
  })

  it('settles pending captures before writing', async () => {
    let settled = false
    const pending = Promise.reject(new Error('ignored')).catch(() => {
      settled = true
    })
    await finalizeTraceExport(baseCtx({ awaitPending: [pending] }))
    expect(settled).toBe(true)
    expect(await exists(path.join(outputDir, 'trace-abcd1234.zip'))).toBe(true)
  })

  describe('retention wiring', () => {
    it("writes everything under the default 'on' policy", async () => {
      const result = await finalizeTraceExport(
        baseCtx({
          policy: 'on',
          testMetadata: meta([
            [
              'u1',
              { title: 'T', specFile: '/a.js', state: 'passed', attempt: 0 }
            ]
          ])
        })
      )
      expect(result[0]!.retained).toBe(true)
      expect(await exists(path.join(outputDir, 'trace-abcd1234.zip'))).toBe(
        true
      )
    })

    // Forward-looking: the retention decision is consulted now (B3 flips the
    // option). A non-default policy with all-passing outcomes must NOT write,
    // proving shouldRetainTrace gates the write rather than being dead-wired.
    it('reports retained:false and writes nothing when the policy declines', async () => {
      const result = await finalizeTraceExport(
        baseCtx({
          policy: 'retain-on-failure',
          testMetadata: meta([
            [
              'u1',
              { title: 'T', specFile: '/a.js', state: 'passed', attempt: 0 }
            ]
          ])
        })
      )
      expect(result).toHaveLength(1)
      expect(result[0]!.retained).toBe(false)
      expect(result[0]!.path).toBe('')
      expect(await fs.readdir(outputDir)).toEqual([])
      expect(artifacts).toHaveLength(1)
      expect(artifacts[0]!.retained).toBe(false)
    })

    it('writes when a retain-on-failure policy sees a failure', async () => {
      const result = await finalizeTraceExport(
        baseCtx({
          policy: 'retain-on-failure',
          testMetadata: meta([
            [
              'u1',
              { title: 'T', specFile: '/a.js', state: 'failed', attempt: 0 }
            ]
          ])
        })
      )
      expect(result[0]!.retained).toBe(true)
      expect(await exists(path.join(outputDir, 'trace-abcd1234.zip'))).toBe(
        true
      )
    })

    // The ledger fix: collapsed testMetadata carries only the final (passed)
    // attempt, so a metadata-only feed can't see the failed first attempt. The
    // per-attempt ledger supplies both, so the failure policies key correctly.
    function failThenPassLedger(): TestAttemptTracker {
      const ledger = new TestAttemptTracker()
      ledger.recordStart('u1', '/a.js')
      ledger.recordOutcome('u1', 'failed')
      ledger.recordStart('u1', '/a.js')
      ledger.recordOutcome('u1', 'passed')
      return ledger
    }
    const finalPassedMeta = meta([
      ['u1', { title: 'T', specFile: '/a.js', state: 'passed', attempt: 1 }]
    ])

    it('retain-on-first-failure retains a fail-then-pass via the ledger', async () => {
      const result = await finalizeTraceExport(
        baseCtx({
          policy: 'retain-on-first-failure',
          attemptInfoAvailable: true,
          outcomes: failThenPassLedger(),
          testMetadata: finalPassedMeta
        })
      )
      expect(result[0]!.retained).toBe(true)
      expect(await exists(path.join(outputDir, 'trace-abcd1234.zip'))).toBe(
        true
      )
    })

    it('retain-on-failure does NOT retain a fail-then-pass (final attempt passed)', async () => {
      const result = await finalizeTraceExport(
        baseCtx({
          policy: 'retain-on-failure',
          attemptInfoAvailable: true,
          outcomes: failThenPassLedger(),
          testMetadata: finalPassedMeta
        })
      )
      expect(result[0]!.retained).toBe(false)
      expect(result[0]!.path).toBe('')
    })

    it('falls back to metadata when the scoped ledger view is empty', async () => {
      // outcomes present but this scope's view is empty (e.g. an adapter that
      // didn't feed this scope): must use metadata, not fail-open into retaining
      // a passing test.
      const emptyView = { all: () => [], forSpec: () => [], forTest: () => [] }
      const result = await finalizeTraceExport(
        baseCtx({
          policy: 'retain-on-failure',
          attemptInfoAvailable: true,
          outcomes: emptyView,
          testMetadata: meta([
            [
              'u1',
              { title: 'T', specFile: '/a.js', state: 'passed', attempt: 0 }
            ]
          ])
        })
      )
      expect(result[0]!.retained).toBe(false)
    })

    // Session slice = OR over every test: one failure keeps the whole trace.
    it('session slice retains when ANY test failed under retain-on-failure', async () => {
      const result = await finalizeTraceExport(
        baseCtx({
          policy: 'retain-on-failure',
          testMetadata: meta([
            [
              'u1',
              { title: 'T1', specFile: '/a.js', state: 'passed', attempt: 0 }
            ],
            [
              'u2',
              { title: 'T2', specFile: '/a.js', state: 'failed', attempt: 0 }
            ]
          ])
        })
      )
      expect(result[0]!.retained).toBe(true)
      expect(await exists(path.join(outputDir, 'trace-abcd1234.zip'))).toBe(
        true
      )
    })

    // Spec slice = per-spec decision: the failing spec writes, the clean one
    // does not — proving the retention gate runs against each spec's own tests.
    it('spec slices retain per-spec failure under retain-on-failure', async () => {
      const result = await finalizeTraceExport(
        baseCtx({
          granularity: 'spec',
          policy: 'retain-on-failure',
          ranges: [range('/a.js', 0), range('/b.js', 2)],
          testMetadata: meta([
            [
              'a1',
              { title: 'A1', specFile: '/a.js', state: 'failed', attempt: 0 }
            ],
            [
              'b1',
              { title: 'B1', specFile: '/b.js', state: 'passed', attempt: 0 }
            ]
          ])
        })
      )
      expect(result).toHaveLength(2)
      const a = result.find((r) => r.key === '/a.js')!
      const b = result.find((r) => r.key === '/b.js')!
      expect(a.retained).toBe(true)
      expect(b.retained).toBe(false)
      const nameA = buildSpecSessionId('/a.js', 'abcd1234')
      const nameB = buildSpecSessionId('/b.js', 'abcd1234')
      expect(await exists(path.join(outputDir, `trace-${nameA}.zip`))).toBe(
        true
      )
      expect(await exists(path.join(outputDir, `trace-${nameB}.zip`))).toBe(
        false
      )
    })
  })

  it('applies prepareSnapshots only to the session write', async () => {
    const prepare = vi.fn((s: unknown[]) => s)
    await finalizeTraceExport(baseCtx({ prepareSnapshots: prepare as never }))
    expect(prepare).toHaveBeenCalledOnce()
  })
})

describe('flushRangeTrace', () => {
  let outputDir: string
  beforeEach(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flush-range-'))
  })
  afterEach(async () => {
    await fs.rm(outputDir, { recursive: true, force: true })
  })

  function ctx(
    overrides: Partial<TraceExportContext> = {}
  ): TraceExportContext {
    return {
      mode: 'trace',
      granularity: 'spec',
      format: 'zip',
      capturer: makeCapturer(),
      actionSnapshots: [],
      sessionId: 'sess0001',
      testMetadata: new Map(),
      ranges: [],
      flushed: new Set(),
      resolveOutputDir: () => outputDir,
      ...overrides
    }
  }

  it('adds the spec to the flushed set and returns the written artifact', async () => {
    const flushed = new Set<string>()
    const artifact = await flushRangeTrace(
      ctx({ flushed }),
      range('/spec.js', 0)
    )
    expect(artifact?.scope).toBe('spec')
    expect(artifact?.key).toBe('/spec.js')
    expect(flushed.has('/spec.js')).toBe(true)
    const name = buildSpecSessionId('/spec.js', 'sess0001')
    await expect(
      fs.access(path.join(outputDir, `trace-${name}.zip`))
    ).resolves.toBeUndefined()
  })

  it('returns undefined for an already-flushed spec', async () => {
    const flushed = new Set<string>(['/spec.js'])
    const artifact = await flushRangeTrace(
      ctx({ flushed }),
      range('/spec.js', 0)
    )
    expect(artifact).toBeUndefined()
  })
})
