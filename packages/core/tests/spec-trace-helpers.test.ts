import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import {
  buildSpecCapturer,
  buildSpecSessionId,
  buildTestSliceFolder,
  buildTestSliceSessionId,
  filterTestMetadataBySpec,
  findFlushableRange,
  filterTestMetadataByUid,
  recordSliceBoundary,
  recordSpecBoundary,
  sanitizeSpecName,
  writeSpecTrace,
  writeTestSliceTrace,
  type SpecBoundaryContext,
  type SpecRange,
  type TraceCapturer,
  type WriteSpecTraceInput
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
      }
    })
    expect(recordSliceBoundary(ctx, 'test', '/a.js', 'u1')).toBeNull()
    expect(ctx.specRanges).toHaveLength(1)
    expect(ctx.specRanges[0]!.key).toBe('u1')
    expect(ctx.specRanges[0]!.testUid).toBe('u1')
    expect(ctx.specRanges[0]!.commandStartIdx).toBe(2)

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

describe('buildTestSliceFolder', () => {
  it('combines sanitized spec, title slug, browser slug, and key hash', () => {
    expect(
      buildTestSliceFolder(
        '/tests/login.e2e.js',
        'shows an error message for an invalid username',
        'chrome',
        'u1'
      )
    ).toMatch(
      /^login_e2e-shows-an-error-message-for-an-invalid-username-chrome-[a-z0-9]{1,8}$/
    )
  })

  it('gives two same-title tests distinct folders (no collision)', () => {
    const a = buildTestSliceFolder('/login.feature', 'As a user', 'chrome', 'A')
    const b = buildTestSliceFolder('/login.feature', 'As a user', 'chrome', 'B')
    expect(a).not.toBe(b)
  })

  it('appends a -retry<N> suffix after the key hash on a retry key', () => {
    expect(
      buildTestSliceFolder('/a.js', 'My Test', 'chrome', 'u1-retry2')
    ).toMatch(/^a-my-test-chrome-[a-z0-9]{1,8}-retry2$/)
  })

  it('defaults the browser slug to "browser" when the browser is absent', () => {
    expect(buildTestSliceFolder('/a.js', 'My Test', undefined, 'u1')).toMatch(
      /^a-my-test-browser-[a-z0-9]{1,8}$/
    )
  })

  it('falls back to a stable short hash of the key when the title is empty', () => {
    const folder = buildTestSliceFolder('/a.js', '', 'chrome', 'u1')
    expect(folder).toMatch(/^a-[a-z0-9]+-chrome-[a-z0-9]+$/)
    expect(buildTestSliceFolder('/a.js', undefined, 'chrome', 'u1')).toBe(
      folder
    )
  })

  it('lowercases, collapses non-alphanumerics, and caps the slug length', () => {
    const folder = buildTestSliceFolder(
      '/a.js',
      `${'A'.repeat(80)} !!! End`,
      'Chrome',
      'u1'
    )
    const titleSlug = folder.slice('a-'.length, folder.lastIndexOf('-chrome'))
    expect(titleSlug.length).toBeLessThanOrEqual(60)
    expect(titleSlug).toMatch(/^[a-z0-9-]+$/)
    expect(titleSlug.endsWith('-')).toBe(false)
  })
})

describe('writeTestSliceTrace / writeSpecTrace output layout', () => {
  let outputDir: string
  beforeEach(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'slice-layout-'))
  })
  afterEach(async () => {
    await fs.rm(outputDir, { recursive: true, force: true })
  })

  const writableCapturer = (): TraceCapturer => ({
    mutations: [],
    traceLogs: [],
    consoleLogs: [],
    networkRequests: [],
    commandsLog: [
      { command: 'url', args: ['https://example.test'], timestamp: 1000 }
    ],
    sources: new Map(),
    metadata: { type: TraceType.Standalone },
    startWallTime: 1000
  })

  const input = (
    over: Partial<WriteSpecTraceInput> = {}
  ): WriteSpecTraceInput => ({
    range: range({ specFile: '/tests/login.js', key: 'u1', testUid: 'u1' }),
    capturer: writableCapturer(),
    actionSnapshots: [],
    sessionId: 'sess1234',
    outputDir,
    testMetadata: new Map([
      ['u1', { title: 'My Test', specFile: '/tests/login.js' }]
    ]),
    capabilities: { browserName: 'firefox' },
    ...over
  })

  it('writes a test slice into <folder>/trace.zip', async () => {
    const written = await writeTestSliceTrace(input())
    const folder = buildTestSliceFolder(
      '/tests/login.js',
      'My Test',
      'firefox',
      'u1'
    )
    expect(folder).toMatch(/^login-my-test-firefox-[a-z0-9]{1,8}$/)
    expect(written).toBe(path.join(outputDir, folder, 'trace.zip'))
    await expect(fs.access(written)).resolves.toBeUndefined()
  })

  it('windows a test slice to its own commands and rebases to its start', async () => {
    // Two tests in one session; the second's slice must exclude the first's
    // frames (the reloadSession-desync bug) and rebase to its own start, not
    // the session start (the huge-empty-prefix bug).
    const capturer: TraceCapturer = {
      mutations: [],
      traceLogs: [],
      consoleLogs: [],
      networkRequests: [],
      commandsLog: [
        { command: 'url', args: ['a'], timestamp: 1000 },
        { command: 'click', args: [], timestamp: 2000 },
        // B's opening url: invoked at 4800, completes at 5000 — its load frames
        // land in [4800, 5000) and must belong to B, not A.
        { command: 'url', args: ['b'], timestamp: 5000, startTime: 4800 },
        { command: 'click', args: [], timestamp: 6000 }
      ],
      sources: new Map(),
      metadata: { type: TraceType.Standalone },
      startWallTime: 1000
    }
    const frames = [
      { data: Buffer.from('a1').toString('base64'), timestamp: 1500 },
      { data: Buffer.from('a2').toString('base64'), timestamp: 2500 },
      { data: Buffer.from('bload').toString('base64'), timestamp: 4900 },
      { data: Buffer.from('b1').toString('base64'), timestamp: 5200 },
      { data: Buffer.from('b2').toString('base64'), timestamp: 6200 }
    ]
    const dir = await writeTestSliceTrace(
      input({
        range: range({
          specFile: '/t.js',
          key: 'B',
          testUid: 'B',
          commandStartIdx: 2
        }),
        capturer,
        screencastFrames: frames,
        format: 'ndjson-directory',
        testMetadata: new Map([['B', { title: 'Test B', specFile: '/t.js' }]])
      })
    )
    const events = (await fs.readFile(path.join(dir, 'trace.trace'), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>)
    const frameOffsets = events
      .filter((e) => e.type === 'screencast-frame')
      .map((e) => e.timestamp as number)
      .sort((x, y) => x - y)
    // Rebased against B's first-command invocation (startTime 4800), and B's
    // in-flight load frame is kept: 4900→100, 5200→400, 6200→1400. Test A's
    // frames (1500/2500) are excluded, not bled in.
    expect(frameOffsets).toEqual([100, 400, 1400])
  })

  it('windows a command-less slice by its own console/network and rebases', async () => {
    // An assertion-only test records no commands, so there is no command to
    // anchor the wall-clock window on. The slice must anchor on the earliest of
    // its own console/network *epoch* timestamps and rebase to it. The network
    // request carries a small performance.now `startTime` (50) alongside its
    // epoch `timestamp` (2000) — the fallback MUST use `.timestamp`; using
    // `.startTime` would anchor the window at 50 and sweep the pre-window 1500
    // snapshot in with a garbage cross-clock offset.
    const capturer: TraceCapturer = {
      mutations: [],
      traceLogs: [],
      consoleLogs: [{ type: 'info', args: ['hi'], timestamp: 2600 }],
      networkRequests: [
        {
          id: 'r1',
          url: 'https://example.test',
          method: 'GET',
          type: 'fetch',
          startTime: 50,
          timestamp: 2000
        }
      ],
      commandsLog: [],
      sources: new Map(),
      metadata: { type: TraceType.Standalone },
      startWallTime: 1000
    }
    const snapshots = [
      { command: 'assert', timestamp: 1500, screenshot: 'QQ==' },
      { command: 'assert', timestamp: 2200, screenshot: 'QkI=' },
      { command: 'assert', timestamp: 2500, screenshot: 'Q0M=' }
    ]
    const dir = await writeTestSliceTrace(
      input({
        range: range({ specFile: '/t.js', key: 'A', testUid: 'A' }),
        capturer,
        actionSnapshots: snapshots,
        format: 'ndjson-directory',
        testMetadata: new Map([['A', { title: 'Test A', specFile: '/t.js' }]])
      })
    )
    const events = (await fs.readFile(path.join(dir, 'trace.trace'), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>)
    // Window anchors on the earliest epoch timestamp (network .timestamp 2000):
    // the pre-window 1500 snapshot is excluded; the sparse filmstrip re-anchors
    // its first in-window frame (2200) to 0 and 2500 lands at 500. (Using the
    // perf.now .startTime of 50 would instead admit 1500 → [0, 2150, 2450].)
    const frameOffsets = events
      .filter((e) => e.type === 'screencast-frame')
      .map((e) => e.timestamp as number)
      .sort((x, y) => x - y)
    expect(frameOffsets).toEqual([0, 500])
    // Console (2600) rebased to the same window start (2000), not the session offset.
    const consoleTimes = events
      .filter((e) => e.type === 'console')
      .map((e) => e.time as number)
    expect(consoleTimes).toEqual([600])
  })

  it('keeps the spec write flat as trace-<id>.zip (unchanged layout)', async () => {
    const written = await writeSpecTrace(
      input({
        range: range({ specFile: '/tests/login.js', key: '/tests/login.js' })
      })
    )
    const name = buildSpecSessionId('/tests/login.js', 'sess1234')
    expect(written).toBe(path.join(outputDir, `trace-${name}.zip`))
    await expect(fs.access(written)).resolves.toBeUndefined()
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

describe('findFlushableRange', () => {
  const mk = (key: string, testUid?: string): SpecRange => ({
    specFile: 'f',
    key,
    testUid,
    commandStartIdx: 0,
    consoleStartIdx: 0,
    networkStartIdx: 0,
    mutationStartIdx: 0,
    traceLogStartIdx: 0
  })

  it('reverse-scans for the given testUid (latest retry attempt wins)', () => {
    const ranges = [mk('a', 'a'), mk('b', 'b'), mk('b-retry1', 'b')]
    expect(findFlushableRange(ranges, 'b')?.key).toBe('b-retry1')
    expect(findFlushableRange(ranges, 'a')?.key).toBe('a')
  })

  it('returns undefined when no range matches the testUid', () => {
    expect(findFlushableRange([mk('spec.ts', undefined)], 'x')).toBeUndefined()
    expect(findFlushableRange([], 'x')).toBeUndefined()
  })

  it('falls back to the last recorded range when no testUid is given', () => {
    const ranges = [mk('a', 'a'), mk('b', 'b')]
    expect(findFlushableRange(ranges)?.key).toBe('b')
    expect(findFlushableRange([])).toBeUndefined()
  })
})
