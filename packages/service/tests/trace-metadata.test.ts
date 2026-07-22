import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as DevtoolsCore from '@wdio/devtools-core'
import { deterministicUid } from '@wdio/devtools-core'
import {
  cucumberScenarioUid,
  resultToState,
  testMetadataUid
} from '../src/test-metadata.js'

// Captures the ctx handed to finalizeTraceExport so the test can inspect the
// state stamped onto testMetadata and the policy that flowed in.
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

// Keep the after* hooks from touching a real browser/CDP.
vi.mock('../src/action-snapshot.js', () => ({
  captureActionSnapshot: vi.fn().mockResolvedValue(null),
  captureActionResult: vi.fn().mockResolvedValue(undefined),
  waitForActionResult: vi.fn().mockResolvedValue(undefined)
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
