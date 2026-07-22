import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resetSignatureCounters } from '../src/helpers/utils.js'
import { TestManager } from '../src/helpers/testManager.js'
import { SuiteManager } from '../src/helpers/suiteManager.js'
import { TestReporter } from '../src/reporter.js'
import { SessionCapturer } from '../src/session.js'
import {
  flushCurrentTestTrace,
  recordTraceBoundary,
  type SessionLifecycleCtx
} from '../src/session-lifecycle.js'
import type { TraceGranularity } from '../src/types.js'

const SESSION_ID = 'sess-abcd1234ef'

const capturers: SessionCapturer[] = []
const tmpDirs: string[] = []

afterEach(() => {
  while (capturers.length) {
    capturers.pop()!.cleanup()
  }
  while (tmpDirs.length) {
    fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true })
  }
})

function makeTmpSpec(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sel-trace-gran-'))
  tmpDirs.push(dir)
  return path.join(dir, 'login.spec.ts')
}

function makeCtx(
  granularity: TraceGranularity,
  specFile: string,
  withSessionId = false
) {
  resetSignatureCounters()
  const reporter = new TestReporter(vi.fn())
  const suiteManager = new SuiteManager(reporter)
  const rootSuite = suiteManager.getOrCreateRootSuite(specFile, 'Suite')
  const testManager = new TestManager(rootSuite, reporter, suiteManager)
  const capturer = new SessionCapturer()
  capturers.push(capturer)
  if (withSessionId) {
    // Only sessionId matters to the flush path; the rest of Metadata is
    // filled with writeTraceZip's defaults, so a partial cast is safe here.
    capturer.metadata = { sessionId: SESSION_ID } as SessionCapturer['metadata']
  }

  // Minimal structural ctx: the boundary/flush helpers read only the trace
  // accumulators, options, capturer, test/suite managers and testFilePath, so
  // we cast a partial to the full lifecycle interface.
  const ctx = {
    options: {
      mode: 'trace',
      tracePolicy: 'on',
      traceGranularity: granularity,
      traceFormat: 'zip'
    },
    sessionCapturer: capturer,
    testManager,
    suiteManager,
    testFilePath: specFile,
    actionSnapshots: [],
    snapshotCaptures: [],
    specRanges: [],
    flushedSpecs: new Set<string>(),
    traceFlushes: []
  } as unknown as SessionLifecycleCtx

  return { ctx, capturer, testManager }
}

describe('trace granularity: test', () => {
  it('records one per-test slice keyed by the started test uid', () => {
    const spec = makeTmpSpec()
    const { ctx, testManager } = makeCtx('test', spec)

    const test = testManager.startMarkedTest('logs in')
    recordTraceBoundary(ctx, spec)

    expect(ctx.specRanges).toHaveLength(1)
    expect(ctx.specRanges[0].testUid).toBe(test.uid)
    expect(ctx.specRanges[0].key).toBe(test.uid)
    expect(ctx.specRanges[0].specFile).toBe(spec)
  })

  it('re-recording the same active test is idempotent (no spurious slice)', () => {
    const spec = makeTmpSpec()
    const { ctx, testManager } = makeCtx('test', spec)

    testManager.startMarkedTest('logs in')
    recordTraceBoundary(ctx, spec)
    // Mirrors the buffered-first-test replay: startTest recorded nothing (no
    // capturer yet), flushPendingTestActions re-invokes for the same test.
    recordTraceBoundary(ctx, spec)

    expect(ctx.specRanges).toHaveLength(1)
  })

  it('a retry gets its own distinct slice (selenium gives each attempt a uid)', () => {
    const spec = makeTmpSpec()
    const { ctx, testManager } = makeCtx('test', spec)

    const first = testManager.startMarkedTest('flaky')
    recordTraceBoundary(ctx, spec)
    testManager.endCurrent('failed')

    const retry = testManager.startMarkedTest('flaky')
    recordTraceBoundary(ctx, spec)
    testManager.endCurrent('passed')

    expect(first.uid).not.toBe(retry.uid)
    expect(ctx.specRanges).toHaveLength(2)
    expect(ctx.specRanges.map((r) => r.key)).toEqual([first.uid, retry.uid])
  })

  it('eager-flushes each test to its own artifact at test end', async () => {
    const spec = makeTmpSpec()
    const outDir = path.dirname(spec)
    const { ctx, testManager } = makeCtx('test', spec, true)

    testManager.startMarkedTest('logs in')
    recordTraceBoundary(ctx, spec)
    testManager.endCurrent('passed')
    flushCurrentTestTrace(ctx)

    testManager.startMarkedTest('logs out')
    recordTraceBoundary(ctx, spec)
    testManager.endCurrent('passed')
    flushCurrentTestTrace(ctx)

    expect(ctx.traceFlushes).toHaveLength(2)
    // Both slice keys are recorded as flushed synchronously, so end-of-run
    // finalizeTraceExport dedupes and won't re-write them.
    expect(ctx.flushedSpecs.size).toBe(2)
    await Promise.all(ctx.traceFlushes)

    // Per-test slices land under test-results/<spec--title-browser>/trace.zip,
    // so recurse to find them rather than scanning the flat dir.
    const zips = fs
      .readdirSync(outDir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.zip'))
    expect(zips).toHaveLength(2)
    expect(zips.every((f) => path.basename(f) === 'trace.zip')).toBe(true)
    expect(zips.every((f) => f.includes('test-results'))).toBe(true)
  })

  it('flushCurrentTestTrace is a no-op with no recorded range', () => {
    const spec = makeTmpSpec()
    const { ctx } = makeCtx('test', spec, true)
    flushCurrentTestTrace(ctx)
    expect(ctx.traceFlushes).toHaveLength(0)
    expect(ctx.flushedSpecs.size).toBe(0)
  })
})

describe('trace granularity: spec/session unchanged', () => {
  it('spec granularity still records one slice per spec file, keyed by file', () => {
    const specA = makeTmpSpec()
    const specB = makeTmpSpec()
    const { ctx } = makeCtx('spec', specA)

    recordTraceBoundary(ctx, specA)
    recordTraceBoundary(ctx, specA) // same file → shares the slice
    recordTraceBoundary(ctx, specB)

    expect(ctx.specRanges.map((r) => r.key)).toEqual([specA, specB])
    expect(ctx.specRanges.every((r) => r.testUid === undefined)).toBe(true)
  })

  it('session granularity records no slices and never eager-flushes', () => {
    const spec = makeTmpSpec()
    const { ctx, testManager } = makeCtx('session', spec, true)

    testManager.startMarkedTest('logs in')
    recordTraceBoundary(ctx, spec)
    testManager.endCurrent('passed')
    flushCurrentTestTrace(ctx)

    expect(ctx.specRanges).toHaveLength(0)
    expect(ctx.traceFlushes).toHaveLength(0)
  })
})
