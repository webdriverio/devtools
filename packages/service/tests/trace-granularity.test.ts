import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as DevtoolsCore from '@wdio/devtools-core'
import { deterministicUid, type SpecRange } from '@wdio/devtools-core'
import { findCurrentTestRange } from '../src/trace-slices.js'

// Records the key/state observed at each per-slice flush and replays the real
// dedupe (flushed.add) so recordSliceBoundary's prev-slice logic behaves as in
// production — otherwise a boundary change would re-flush an already-flushed
// slice. Capturing state at call time is what proves the eager flush sees this
// attempt's outcome before a retry's beforeTest overwrites the entry.
const flushedSlices: Array<{ key: string; testUid?: string; state?: string }> =
  []

type FlushCtx = {
  flushed: Set<string>
  testMetadata: Map<string, { state?: string }>
}

const flushRangeTrace = vi.fn(
  (ctx: FlushCtx, range: { key: string; testUid?: string }) => {
    ctx.flushed.add(range.key)
    flushedSlices.push({
      key: range.key,
      testUid: range.testUid,
      state: range.testUid
        ? ctx.testMetadata.get(range.testUid)?.state
        : undefined
    })
    return Promise.resolve(undefined)
  }
)

const finalizeTraceExport = vi.fn().mockResolvedValue([])

vi.mock('stack-trace', () => ({ parse: () => [] }))

const mockSessionCapturerInstance = {
  afterCommand: vi.fn(),
  sendUpstream: vi.fn(),
  injectScript: vi.fn().mockResolvedValue(undefined),
  captureAssertCommand: vi.fn(),
  failLastAction: vi.fn(),
  resetLastSelector: vi.fn(),
  resetRetryTracker: vi.fn(),
  cleanup: vi.fn(),
  commandsLog: [] as unknown[],
  sources: new Map(),
  mutations: [],
  traceLogs: [],
  consoleLogs: [],
  networkRequests: [],
  metadata: { url: 'http://test.com', viewport: {} }
}

vi.mock('../src/session.js', () => ({
  SessionCapturer: vi.fn(function (this: unknown) {
    return mockSessionCapturerInstance
  })
}))

vi.mock('../src/action-snapshot.js', () => ({
  captureActionSnapshot: vi.fn().mockResolvedValue(null),
  captureActionResult: vi.fn().mockResolvedValue(undefined),
  waitForActionResult: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@wdio/devtools-core', async (importOriginal) => {
  const actual = await importOriginal<typeof DevtoolsCore>()
  return {
    ...actual,
    finalizeTraceExport: (ctx: unknown) => finalizeTraceExport(ctx),
    // The adapter now flushes via core's flushRangeLogged wrapper; route it to
    // the same spy so call-count/argument assertions still observe each flush.
    flushRangeLogged: (ctx: unknown, range: unknown) =>
      flushRangeTrace(
        ctx as FlushCtx,
        range as { key: string; testUid?: string }
      ),
    flushRangeTrace: (ctx: unknown, range: unknown) =>
      flushRangeTrace(
        ctx as FlushCtx,
        range as { key: string; testUid?: string }
      )
  }
})

// Imported after the mocks are declared so the mocked core module is used.
const { default: DevToolsHookService } = await import('../src/index.js')

describe('findCurrentTestRange', () => {
  const mk = (key: string, testUid?: string): SpecRange => ({
    specFile: 'f',
    key,
    testUid,
    commandStartIdx: 0,
    consoleStartIdx: 0,
    networkStartIdx: 0,
    mutationStartIdx: 0,
    traceLogStartIdx: 0,
    snapshotCount: 0
  })

  it('returns the most recent range recorded under the base testUid', () => {
    const ranges = [mk('a', 'a'), mk('b', 'b'), mk('b-retry1', 'b')]
    // A retry pushes a new range under the same testUid; the latest one wins.
    expect(findCurrentTestRange(ranges, 'b')?.key).toBe('b-retry1')
    expect(findCurrentTestRange(ranges, 'a')?.key).toBe('a')
  })

  it('returns undefined when no range matches (spec/session slices)', () => {
    expect(
      findCurrentTestRange([mk('spec.ts', undefined)], 'x')
    ).toBeUndefined()
    expect(findCurrentTestRange([], 'x')).toBeUndefined()
  })
})

describe('DevtoolsService - trace granularity slicing', () => {
  const file = '/proj/specs/login.spec.ts'
  const mockBrowser = {
    isBidi: true,
    sessionId: 'sess-1',
    scriptAddPreloadScript: vi.fn().mockResolvedValue(undefined),
    takeScreenshot: vi.fn().mockResolvedValue('shot'),
    execute: vi
      .fn()
      .mockResolvedValue({ width: 1, height: 1, offsetLeft: 0, offsetTop: 0 }),
    on: vi.fn(),
    emit: vi.fn(),
    options: { rootDir: '/proj' },
    capabilities: { browserName: 'chrome' }
  } as never

  beforeEach(() => {
    vi.clearAllMocks()
    finalizeTraceExport.mockResolvedValue([])
    flushedSlices.length = 0
  })

  async function newService(granularity: 'session' | 'spec' | 'test') {
    const service = new DevToolsHookService({
      mode: 'trace',
      tracePolicy: 'retain-on-failure',
      traceGranularity: granularity
    })
    await service.before({} as never, [], mockBrowser)
    return service
  }

  it('test granularity: records a per-test slice at beforeTest and eager-flushes it at afterTest', async () => {
    const service = await newService('test')
    const title = 'login works'
    const uid = deterministicUid(file, title)

    service.beforeTest({ file, fullTitle: title })
    expect(flushRangeTrace).not.toHaveBeenCalled()

    await service.afterTest({ file, fullTitle: title }, {}, { passed: true })

    expect(flushRangeTrace).toHaveBeenCalledTimes(1)
    // The flushed range is the one recorded at beforeTest (found via testUid),
    // proving both the start-boundary and the eager end-flush.
    expect(flushRangeTrace.mock.calls[0]![1]).toMatchObject({
      key: uid,
      testUid: uid
    })
    expect(flushedSlices).toEqual([{ key: uid, testUid: uid, state: 'passed' }])
  })

  it('test granularity: a retried test produces a distinct retry slice, each with its own attempt outcome', async () => {
    const service = await newService('test')
    const title = 'flaky login'
    const uid = deterministicUid(file, title)

    // Attempt 1 fails, then a same-process retry (Mocha) passes.
    service.beforeTest({ file, fullTitle: title })
    await service.afterTest(
      { file, fullTitle: title },
      {},
      { passed: false, error: new Error('boom') }
    )
    service.beforeTest({ file, fullTitle: title })
    await service.afterTest({ file, fullTitle: title }, {}, { passed: true })

    expect(flushRangeTrace).toHaveBeenCalledTimes(2)
    // Each attempt is its own slice, and each slice was written with that
    // attempt's just-stamped state — the failed first attempt survives the
    // retry's beforeTest overwrite (the retain-on-first-failure fix).
    expect(flushedSlices).toEqual([
      { key: uid, testUid: uid, state: 'failed' },
      { key: `${uid}-retry1`, testUid: uid, state: 'passed' }
    ])
  })

  it('test granularity: Cucumber scenario eager-flushes its slice at afterScenario', async () => {
    const service = await newService('test')
    const uri = '/proj/features/login.feature'
    const name = 'log in'
    const uid = deterministicUid(uri, name)

    service.beforeScenario({ pickle: { uri, name } })
    await service.afterScenario({ pickle: { uri, name } }, { passed: true })

    expect(flushRangeTrace).toHaveBeenCalledTimes(1)
    expect(flushRangeTrace.mock.calls[0]![1]).toMatchObject({
      key: uid,
      testUid: uid
    })
  })

  it('spec granularity: no eager flush at afterTest; flushes only when the spec file changes', async () => {
    const service = await newService('spec')
    const other = '/proj/specs/cart.spec.ts'

    service.beforeTest({ file, fullTitle: 't1' })
    await service.afterTest({ file, fullTitle: 't1' }, {}, { passed: true })
    // Two tests in the same spec: neither the end-flush nor a boundary fires.
    service.beforeTest({ file, fullTitle: 't2' })
    await service.afterTest({ file, fullTitle: 't2' }, {}, { passed: true })
    expect(flushRangeTrace).not.toHaveBeenCalled()

    // A new spec file flushes the previous spec's slice (fire-and-forget).
    service.beforeTest({ file: other, fullTitle: 't3' })
    expect(flushRangeTrace).toHaveBeenCalledTimes(1)
    const range = flushRangeTrace.mock.calls[0]![1] as SpecRange
    expect(range.key).toBe(file)
    expect(range.testUid).toBeUndefined()
  })

  it('session granularity: records no slices and never flushes per test', async () => {
    const service = await newService('session')

    service.beforeTest({ file, fullTitle: 't1' })
    await service.afterTest({ file, fullTitle: 't1' }, {}, { passed: true })
    service.beforeTest({ file, fullTitle: 't2' })
    await service.afterTest({ file, fullTitle: 't2' }, {}, { passed: false })

    expect(flushRangeTrace).not.toHaveBeenCalled()
  })
})
