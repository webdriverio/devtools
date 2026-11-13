import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as DevtoolsCore from '@wdio/devtools-core'
import { deterministicUid } from '@wdio/devtools-core'
import {
  cucumberScenarioUid,
  resultToState,
  retriedTestUid,
  testMetadataUid
} from '../src/test-metadata.js'

// Captures the ctx handed to finalizeTraceExport so the test can inspect the
// state stamped onto testMetadata and the policy that flowed in.
const finalizeTraceExport = vi.fn().mockResolvedValue([])

vi.mock('stack-trace', () => ({ parse: () => [] }))

const mockSessionCapturerInstance = {
  pageResourceStore: {
    configure: vi.fn(),
    settle: vi.fn().mockResolvedValue(undefined)
  },
  afterCommand: vi.fn(),
  sendUpstream: vi.fn(),
  mergeMetadata: vi.fn(),
  injectScript: vi.fn().mockResolvedValue(undefined),
  captureTrace: vi.fn().mockResolvedValue(undefined),
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

// Keep the after* hooks from touching a real browser/CDP.
vi.mock('../src/action-snapshot.js', () => ({
  captureActionSnapshot: vi.fn().mockResolvedValue(null),
  pushActionSnapshotAt: vi.fn().mockResolvedValue(undefined),
  settleAfterLastAction: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@wdio/devtools-core', async (importOriginal) => {
  const actual = await importOriginal<typeof DevtoolsCore>()
  return {
    ...actual,
    finalizeTraceExport: (ctx: unknown) => finalizeTraceExport(ctx)
  }
})

// Imported after the mocks are declared so the mocked core module is used.
const { default: DevToolsHookService } = await import('../src/index.js')

describe('test-metadata helpers', () => {
  it('resultToState maps a WDIO result to the canonical state', () => {
    expect(resultToState({ passed: true })).toBe('passed')
    expect(resultToState({ passed: false })).toBe('failed')
    expect(resultToState({ passed: false, skipped: true })).toBe('skipped')
    // skipped wins even if passed is somehow set alongside it.
    expect(resultToState({ passed: true, skipped: true })).toBe('skipped')
  })

  it('testMetadataUid keys on file+title, falling back to title alone', () => {
    const file = '/proj/specs/a.spec.ts'
    expect(testMetadataUid(file, 'renders')).toBe(
      deterministicUid(file, 'renders')
    )
    expect(testMetadataUid(undefined, 'renders')).toBe('renders')
  })

  it('cucumberScenarioUid separates outline rows sharing a name by astNodeIds', () => {
    const uri = '/proj/features/login.feature'
    const row1 = cucumberScenarioUid(uri, 'log in', ['node-1'])
    const row2 = cucumberScenarioUid(uri, 'log in', ['node-2'])
    // Distinct example rows → distinct uids (so they render as separate groups).
    expect(row1).not.toBe(row2)
    // A rerun of the same row → same uid (retry-coalescing stays intact).
    expect(cucumberScenarioUid(uri, 'log in', ['node-1'])).toBe(row1)
    // No astNodeIds → plain name-based uid.
    expect(cucumberScenarioUid(uri, 'log in')).toBe(
      deterministicUid(uri, 'log in')
    )
  })
})

describe('retriedTestUid', () => {
  const file = '/proj/specs/login.spec.ts'
  const metadata = new Map([
    ['uid-a', { title: 'a logs in', specFile: file }],
    ['uid-b', { title: 'b logs in', specFile: file }],
    [
      'uid-other',
      { title: 'a logs in', specFile: '/proj/specs/other.spec.ts' }
    ],
    ['uid-a:step:1', { title: 'Given I log in', specFile: file }]
  ])
  const started = (uid: string) => !uid.includes(':step:')

  it('names a same-titled test by its suite and file', () => {
    const test = { title: 'logs in', parent: 'b', file }
    expect(retriedTestUid(metadata, started, test, 'uid-a')).toBe('uid-b')
  })

  it('falls back to the current test when nothing started matches (a Cucumber step)', () => {
    const step = { title: 'Given I log in', parent: '0', file }
    expect(retriedTestUid(metadata, started, step, 'uid-a')).toBe('uid-a')
  })

  it('falls back when the title is ambiguous and no suite matches', () => {
    const test = { title: 'logs in', parent: 'c', file }
    expect(retriedTestUid(metadata, started, test, 'uid-b')).toBe('uid-b')
  })
})

describe('DevtoolsService - afterTest state stamping', () => {
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
    addCommand: vi.fn(),
    options: { rootDir: '/proj' },
    capabilities: { browserName: 'chrome' }
  } as never

  beforeEach(() => {
    vi.clearAllMocks()
    finalizeTraceExport.mockResolvedValue([])
  })

  async function runTest(title: string, result: Record<string, unknown>) {
    const service = new DevToolsHookService({
      mode: 'trace',
      tracePolicy: 'retain-on-failure'
    })
    await service.before({} as never, [], mockBrowser)
    service.beforeTest({ file, fullTitle: title })
    await service.afterTest({ file, fullTitle: title }, {}, result)
    await service.after()
    const ctx = finalizeTraceExport.mock.calls.at(-1)?.[0] as {
      policy?: string
      testMetadata: Map<string, { state?: string }>
    }
    return ctx
  }

  it('stamps passed / failed / skipped from the WDIO result', async () => {
    const passed = await runTest('login works', { passed: true })
    expect(
      passed.testMetadata.get(deterministicUid(file, 'login works'))?.state
    ).toBe('passed')

    const failed = await runTest('login fails', {
      passed: false,
      error: new Error('boom')
    })
    expect(
      failed.testMetadata.get(deterministicUid(file, 'login fails'))?.state
    ).toBe('failed')

    const skipped = await runTest('login skipped', {
      passed: false,
      skipped: true
    })
    expect(
      skipped.testMetadata.get(deterministicUid(file, 'login skipped'))?.state
    ).toBe('skipped')
  })

  it('flows the tracePolicy and a failed state into the finalizer ctx', async () => {
    const ctx = await runTest('checkout fails', {
      passed: false,
      error: new Error('x')
    })
    // Both halves of "retain-on-failure is no longer a no-op for WDIO":
    // the policy reached the finalizer, and the failing state is on the entry
    // its retention evaluator reads.
    expect(ctx.policy).toBe('retain-on-failure')
    expect(
      ctx.testMetadata.get(deterministicUid(file, 'checkout fails'))?.state
    ).toBe('failed')
  })

  it('flags attemptInfoAvailable so retry-aware policies use per-test attempt', async () => {
    const ctx = (await runTest('trace opts', { passed: true })) as {
      attemptInfoAvailable?: boolean
    }
    expect(ctx.attemptInfoAvailable).toBe(true)
  })

  it('uses the tracker attempt even when WDIO reports retries.attempts:0', async () => {
    const service = new DevToolsHookService({
      mode: 'trace',
      tracePolicy: 'retain-on-failure-and-retries'
    })
    await service.before({} as never, [], mockBrowser)
    const title = 'flaky login'
    // Two starts before a single end simulate a same-process (Mocha) retry.
    // WDIO's mocha framework reports retries.attempts:0 even on the retry, so
    // the runner field must NOT clobber the tracker's real count of 1.
    service.beforeTest({ file, fullTitle: title })
    service.beforeTest({ file, fullTitle: title })
    await service.afterTest(
      { file, fullTitle: title },
      {},
      { passed: true, retries: { attempts: 0 } }
    )
    await service.after()
    const ctx = finalizeTraceExport.mock.calls.at(-1)?.[0] as {
      testMetadata: Map<string, { attempt?: number }>
    }
    expect(ctx.testMetadata.get(deterministicUid(file, title))?.attempt).toBe(1)
  })

  it('uses the runner attempts count when it exceeds the tracker', async () => {
    const service = new DevToolsHookService({
      mode: 'trace',
      tracePolicy: 'retain-on-failure-and-retries'
    })
    await service.before({} as never, [], mockBrowser)
    const title = 'checkout retries'
    service.beforeTest({ file, fullTitle: title })
    await service.afterTest(
      { file, fullTitle: title },
      {},
      { passed: true, retries: { attempts: 3 } }
    )
    await service.after()
    const ctx = finalizeTraceExport.mock.calls.at(-1)?.[0] as {
      testMetadata: Map<string, { attempt?: number }>
    }
    expect(ctx.testMetadata.get(deterministicUid(file, title))?.attempt).toBe(3)
  })

  it("records the reporter's test:retry on the retried test, not the current one", async () => {
    const service = new DevToolsHookService({
      mode: 'trace',
      tracePolicy: 'retain-on-failure'
    })
    const config = { reporters: [] as unknown[] }
    service.beforeSession(config as never, { browserName: 'chrome' } as never)
    const Reporter = config.reporters.at(-1) as new (options: object) => {
      onTestRetry(stats: unknown): void
    }
    const reporter = new Reporter({ logFile: '/tmp/test.log' })
    await service.before({} as never, [], mockBrowser)
    // Two same-titled tests in different suites interleave; `b` is current when `a` retries.
    service.beforeTest({ file, fullTitle: 'a logs in' })
    service.beforeTest({ file, fullTitle: 'b logs in' })
    // An outcome hook that reads the attempt as passed isolates the retry signal.
    await service.afterTest(
      { file, fullTitle: 'a logs in' },
      {},
      { passed: true }
    )
    reporter.onTestRetry({
      uid: 'stable-x',
      title: 'logs in',
      fullTitle: 'a.logs in',
      parent: 'a',
      file
    })
    await service.afterTest(
      { file, fullTitle: 'b logs in' },
      {},
      { passed: true }
    )
    await service.after()
    const ctx = finalizeTraceExport.mock.calls.at(-1)?.[0] as {
      outcomes: { forTest(uid: string): unknown[] }
    }
    const uidA = deterministicUid(file, 'a logs in')
    const uidB = deterministicUid(file, 'b logs in')
    expect(ctx.outcomes.forTest(uidA)).toEqual([
      { uid: uidA, attempt: 0, state: 'failed' }
    ])
    expect(ctx.outcomes.forTest(uidB)).toEqual([
      { uid: uidB, attempt: 0, state: 'passed' }
    ])
  })

  it('stamps a Cucumber scenario state in afterScenario', async () => {
    const service = new DevToolsHookService({
      mode: 'trace',
      tracePolicy: 'retain-on-failure'
    })
    await service.before({} as never, [], mockBrowser)
    const uri = '/proj/features/cart.feature'
    service.beforeScenario({ pickle: { uri, name: 'add to cart' } })
    await service.afterScenario(
      { pickle: { uri, name: 'add to cart' } },
      { passed: false }
    )
    await service.after()
    const ctx = finalizeTraceExport.mock.calls.at(-1)?.[0] as {
      testMetadata: Map<string, { state?: string }>
    }
    expect(
      ctx.testMetadata.get(deterministicUid(uri, 'add to cart'))?.state
    ).toBe('failed')
  })
})

/**
 * Session metadata resolves on the driver, so it lands after `before()` has
 * returned. A spec that fails immediately therefore finalized while the read
 * was still in flight, and the zip got the exporter's fallback viewport and no
 * device — the values #345 exists to carry. Finalize has to wait for it.
 */
describe('session metadata vs. an immediately finalizing spec', () => {
  const mockBrowser = (
    resolveWindowSize: () => Promise<{ width: number; height: number }>
  ) =>
    ({
      sessionId: 'sess-race',
      isMobile: true,
      isAndroid: true,
      execute: vi.fn().mockResolvedValue(undefined),
      getWindowSize: vi.fn(resolveWindowSize),
      takeScreenshot: vi.fn().mockResolvedValue('shot'),
      getWindowRect: vi.fn().mockResolvedValue({
        width: 1,
        height: 1,
        offsetLeft: 0,
        offsetTop: 0
      }),
      on: vi.fn(),
      emit: vi.fn(),
      addCommand: vi.fn(),
      options: { rootDir: '/proj' },
      capabilities: {
        platformName: 'android',
        deviceName: '28111FDH200CUX',
        udid: '28111FDH200CUX',
        deviceModel: 'Pixel 7',
        platformVersion: '14'
      }
    }) as never

  beforeEach(() => {
    vi.clearAllMocks()
    finalizeTraceExport.mockResolvedValue([])
  })

  it('hands the in-flight read to finalize as pending work', async () => {
    let release: (size: { width: number; height: number }) => void = () => {}
    const service = new DevToolsHookService({ mode: 'trace' })
    await service.before(
      {} as never,
      [],
      mockBrowser(
        () =>
          new Promise<{ width: number; height: number }>((resolve) => {
            release = resolve
          })
      )
    )

    // Finalize while the driver has not answered yet — the race the review
    // found. The promise must reach core, which settles it under its own cap.
    // `metadataCapture` rather than the generic pending list: this read belongs
    // to no slice, so core awaits it for EVERY trace it writes — a per-test
    // slice flushed before it lands would carry the fallback viewport, and an
    // artifact already written cannot be corrected.
    await service.after()
    const ctx = finalizeTraceExport.mock.calls.at(-1)?.[0] as {
      metadataCapture?: Promise<unknown>
    }
    expect(ctx.metadataCapture).toBeDefined()

    release({ width: 1080, height: 2219 })
    await ctx.metadataCapture
    // And once it lands it is STORED, not merely published: the zip reads this.
    expect(mockSessionCapturerInstance.mergeMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        viewport: expect.objectContaining({ width: 1080, height: 2219 }),
        device: { platform: 'android', name: 'Pixel 7', version: '14' }
      })
    )
  })

  it('never rejects, so an unhandled rejection cannot outrun finalize', async () => {
    const service = new DevToolsHookService({ mode: 'trace' })
    await service.before(
      {} as never,
      [],
      mockBrowser(() => Promise.reject(new Error('no such session')))
    )
    await service.after()

    const ctx = finalizeTraceExport.mock.calls.at(-1)?.[0] as {
      metadataCapture?: Promise<unknown>
    }
    await expect(ctx.metadataCapture).resolves.toBeUndefined()
    // The viewport is dropped; everything else the session knew survives.
    expect(mockSessionCapturerInstance.mergeMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        device: { platform: 'android', name: 'Pixel 7', version: '14' }
      })
    )
  })
})
