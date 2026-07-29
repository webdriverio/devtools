// traceGranularity × tracePolicy, as a table.
//
// The individual behaviours are covered in trace-finalizer.test.ts and
// trace-retention.test.ts; what this file adds is the *grid* — every granularity
// against every policy, asserting the exact set of files left in the output
// directory. Two reasons it earns its place next to those:
//
//   1. `readdir` equality catches artifacts that shouldn't be there. An
//      `exists()` assertion passes whether the finalizer wrote one file or ten.
//   2. Extending coverage is a table row, so a new policy can't quietly ship
//      with only the happy path tested.
//
// This is the coverage the deleted fixture harness produced by running real
// browsers per config; it needs neither.

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  buildSpecSessionId,
  buildTestSliceFolder,
  finalizeTraceExport,
  TestAttemptTracker,
  type SpecRange,
  type TraceCapturer,
  type TraceExportContext
} from '@wdio/devtools-core'
import {
  TraceType,
  type TestMetadataEntry,
  type TestMetadataMap
} from '@wdio/devtools-shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SESSION_ID = 'abcd1234'
const SPEC_A = '/specs/a.e2e.js'
const SPEC_B = '/specs/b.e2e.js'

type Policy = NonNullable<TraceExportContext['policy']>

function capturer(): TraceCapturer {
  return {
    mutations: [],
    traceLogs: [],
    consoleLogs: [],
    networkRequests: [],
    commandsLog: Array.from({ length: 4 }, (_, i) => ({
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

function specRange(specFile: string, startIdx: number): SpecRange {
  return {
    specFile,
    key: specFile,
    commandStartIdx: startIdx,
    networkStartIdx: 0,
    mutationStartIdx: 0,
    traceLogStartIdx: 0
  }
}

function testRange(
  specFile: string,
  testUid: string,
  startIdx: number
): SpecRange {
  return { ...specRange(specFile, startIdx), key: testUid, testUid }
}

function meta(entries: Array<[string, TestMetadataEntry]>): TestMetadataMap {
  return new Map(entries)
}

describe('traceGranularity × tracePolicy', () => {
  let outputDir: string

  beforeEach(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'trace-matrix-'))
  })
  afterEach(async () => {
    await fs.rm(outputDir, { recursive: true, force: true })
  })

  function ctx(
    overrides: Partial<TraceExportContext> = {}
  ): TraceExportContext {
    return {
      mode: 'trace',
      granularity: 'session',
      format: 'zip',
      capturer: capturer(),
      actionSnapshots: [],
      sessionId: SESSION_ID,
      testMetadata: new Map(),
      ranges: [],
      flushed: new Set(),
      resolveOutputDir: () => outputDir,
      log: () => {},
      onArtifact: () => {},
      ...overrides
    }
  }

  /** Every path under outputDir, relative and sorted — per-test slices nest a
   *  trace.zip inside a folder, session/spec traces sit at the top level. */
  async function writtenTraces(): Promise<string[]> {
    const found: string[] = []
    const walk = async (dir: string, prefix = ''): Promise<void> => {
      for (const dirent of await fs.readdir(dir, { withFileTypes: true })) {
        const rel = prefix ? path.join(prefix, dirent.name) : dirent.name
        if (dirent.isDirectory()) {
          await walk(path.join(dir, dirent.name), rel)
        } else {
          found.push(rel)
        }
      }
    }
    await walk(outputDir)
    return found.sort()
  }

  const sessionTrace = `trace-${SESSION_ID}.zip`
  const specTrace = (specFile: string) =>
    `trace-${buildSpecSessionId(specFile, SESSION_ID)}.zip`
  const testTrace = (specFile: string, title: string, uid: string) =>
    path.join(
      buildTestSliceFolder(specFile, title, undefined, uid),
      'trace.zip'
    )

  // ── granularity decides the file COUNT ────────────────────────────────────
  // Two tests in two specs, all passing, default policy: the only variable is
  // how the run is sliced.
  describe('granularity fans out (default policy)', () => {
    const twoSpecs = meta([
      ['t1', { title: 'T1', specFile: SPEC_A }],
      ['t2', { title: 'T2', specFile: SPEC_B }]
    ])

    it('session granularity writes exactly one trace for the whole run', async () => {
      await finalizeTraceExport(
        ctx({ granularity: 'session', testMetadata: twoSpecs })
      )
      expect(await writtenTraces()).toEqual([sessionTrace])
    })

    it('spec granularity writes one trace per spec file', async () => {
      await finalizeTraceExport(
        ctx({
          granularity: 'spec',
          ranges: [specRange(SPEC_A, 0), specRange(SPEC_B, 2)],
          testMetadata: twoSpecs
        })
      )
      expect(await writtenTraces()).toEqual(
        [specTrace(SPEC_A), specTrace(SPEC_B)].sort()
      )
    })

    it('test granularity writes one trace per test, each in its own folder', async () => {
      await finalizeTraceExport(
        ctx({
          granularity: 'test',
          ranges: [testRange(SPEC_A, 't1', 0), testRange(SPEC_B, 't2', 2)],
          testMetadata: twoSpecs
        })
      )
      expect(await writtenTraces()).toEqual(
        [testTrace(SPEC_A, 'T1', 't1'), testTrace(SPEC_B, 'T2', 't2')].sort()
      )
    })
  })

  // ── policy decides WHICH of those slices survive ──────────────────────────
  // One spec, two tests: t1 failed, t2 passed, no retries. Expectations follow
  // trace-retention.ts: retain-on-failure keys on each group's final attempt,
  // retain-on-first-failure on attempt 0, and the retry policies need an
  // attempt >= 1 that this run doesn't have.
  describe('policy filters slices (mixed pass/fail, no retries)', () => {
    const mixed = meta([
      ['t1', { title: 'T1', specFile: SPEC_A, state: 'failed', attempt: 0 }],
      ['t2', { title: 'T2', specFile: SPEC_A, state: 'passed', attempt: 0 }]
    ])

    function ledger(): TestAttemptTracker {
      const tracker = new TestAttemptTracker()
      tracker.recordStart('t1', SPEC_A)
      tracker.recordOutcome('t1', 'failed')
      tracker.recordStart('t2', SPEC_A)
      tracker.recordOutcome('t2', 'passed')
      return tracker
    }

    const both = () =>
      [testTrace(SPEC_A, 'T1', 't1'), testTrace(SPEC_A, 'T2', 't2')].sort()
    const failingOnly = () => [testTrace(SPEC_A, 'T1', 't1')]

    it.each<[Policy | undefined, 'both' | 'failing' | 'none']>([
      [undefined, 'both'],
      ['on', 'both'],
      ['retain-on-failure', 'failing'],
      ['retain-on-first-failure', 'failing'],
      ['on-first-retry', 'none'],
      ['on-all-retries', 'none'],
      ['retain-on-failure-and-retries', 'failing']
    ])(
      'test granularity + %s keeps the %s slice(s)',
      async (policy, expected) => {
        await finalizeTraceExport(
          ctx({
            granularity: 'test',
            policy,
            attemptInfoAvailable: true,
            outcomes: ledger(),
            ranges: [testRange(SPEC_A, 't1', 0), testRange(SPEC_A, 't2', 2)],
            testMetadata: mixed
          })
        )
        const want =
          expected === 'both'
            ? both()
            : expected === 'failing'
              ? failingOnly()
              : []
        expect(await writtenTraces()).toEqual(want)
      }
    )

    it('session granularity retains the whole run when any test failed', async () => {
      await finalizeTraceExport(
        ctx({
          granularity: 'session',
          policy: 'retain-on-failure',
          attemptInfoAvailable: true,
          outcomes: ledger(),
          testMetadata: mixed
        })
      )
      expect(await writtenTraces()).toEqual([sessionTrace])
    })

    it('spec granularity drops a spec whose tests all passed', async () => {
      const perSpec = meta([
        ['t1', { title: 'T1', specFile: SPEC_A, state: 'failed', attempt: 0 }],
        ['t2', { title: 'T2', specFile: SPEC_B, state: 'passed', attempt: 0 }]
      ])
      const tracker = new TestAttemptTracker()
      tracker.recordStart('t1', SPEC_A)
      tracker.recordOutcome('t1', 'failed')
      tracker.recordStart('t2', SPEC_B)
      tracker.recordOutcome('t2', 'passed')

      await finalizeTraceExport(
        ctx({
          granularity: 'spec',
          policy: 'retain-on-failure',
          attemptInfoAvailable: true,
          outcomes: tracker,
          ranges: [specRange(SPEC_A, 0), specRange(SPEC_B, 2)],
          testMetadata: perSpec
        })
      )
      expect(await writtenTraces()).toEqual([specTrace(SPEC_A)])
    })
  })

  // ── the retry axis ────────────────────────────────────────────────────────
  // One test, failed then passed on retry. This is where the policies actually
  // diverge, and where a metadata-only feed would see just the passing attempt.
  describe('policy on a fail-then-pass retry', () => {
    function retryLedger(): TestAttemptTracker {
      const tracker = new TestAttemptTracker()
      tracker.recordStart('t1', SPEC_A)
      tracker.recordOutcome('t1', 'failed')
      tracker.recordStart('t1', SPEC_A)
      tracker.recordOutcome('t1', 'passed')
      return tracker
    }

    it.each<[Policy, boolean]>([
      ['retain-on-failure', false],
      ['retain-on-first-failure', true],
      ['on-first-retry', true],
      ['on-all-retries', true],
      ['retain-on-failure-and-retries', true]
    ])('%s retains: %s', async (policy, retained) => {
      await finalizeTraceExport(
        ctx({
          policy,
          attemptInfoAvailable: true,
          outcomes: retryLedger(),
          testMetadata: meta([
            [
              't1',
              { title: 'T1', specFile: SPEC_A, state: 'passed', attempt: 1 }
            ]
          ])
        })
      )
      expect(await writtenTraces()).toEqual(retained ? [sessionTrace] : [])
    })
  })
})
