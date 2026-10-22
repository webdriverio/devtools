import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RetryTracker } from '@wdio/devtools-core'
import type * as DevToolsCore from '@wdio/devtools-core'
import type { ActionSnapshot } from '@wdio/devtools-shared'
import { getDriverOriginals } from '../src/driverPatcher.js'
import { resetSignatureCounters } from '../src/helpers/utils.js'
import { TestManager } from '../src/helpers/testManager.js'
import { SuiteManager } from '../src/helpers/suiteManager.js'
import { TestReporter } from '../src/reporter.js'
import {
  handleOnCommand,
  type OnCommandCtx
} from '../src/helpers/commandPostActions.js'
import {
  flushCurrentTestTrace,
  onDriverCreated,
  onDriverEnd,
  type SessionLifecycleCtx
} from '../src/session-lifecycle.js'
import type { CapturedCommand, SeleniumDriverLike } from '../src/types.js'

const NATIVE = {
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2'
}

const { capabilities } = vi.hoisted(() => ({
  capabilities: { current: {} as Record<string, unknown> }
}))

const { flushed } = vi.hoisted(() => ({ flushed: [] as unknown[] }))

vi.mock('@wdio/devtools-core', async (importOriginal) => ({
  ...(await importOriginal<typeof DevToolsCore>()),
  registerCollectorPreload: vi.fn(async () => false),
  flushRangeLogged: vi.fn(async (_ctx: unknown, range: unknown) => {
    flushed.push(range)
    return undefined
  })
}))

vi.mock('../src/bidi.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  attachBidiHandlers: vi.fn(async () => false)
}))

vi.mock('../src/helpers/driverMetadata.js', () => ({
  buildDriverMetadata: vi.fn(async () => ({
    sessionId: 'sess',
    metadata: { sessionId: 'sess', capabilities: capabilities.current }
  }))
}))

const ENTRY = {
  url: 'https://api.example.com/items',
  method: 'GET',
  statusCode: 200
}

const exec =
  vi.fn<
    (driver: unknown, script: string, ...args: unknown[]) => Promise<unknown>
  >()

const driver = (id: string) => ({ id }) as unknown as SeleniumDriverLike

function makeCtx(interceptRequested: boolean): SessionLifecycleCtx {
  return {
    options: { hostname: 'localhost', port: 0, mode: 'trace' },
    screencastOptions: {},
    detectedRunner: 'mocha',
    interceptRequestedFor: () => interceptRequested,
    finalized: false,
    driver: undefined,
    sessionCapturer: undefined,
    actionSnapshots: [],
    snapshotCaptures: [],
    specRanges: [],
    flushedSpecs: new Set<string>(),
    traceFlushes: [],
    artifacts: [],
    filmstripFrames: [],
    setFinalized: () => {},
    ensureBackendStarted: async () => {},
    flushPendingTestActions: () => {},
    resetRetryTracker: () => {},
    clearKeepAlive: () => {}
  } as unknown as SessionLifecycleCtx
}

const scripts = () =>
  exec.mock.calls.map(([d, script]) => [(d as { id: string }).id, script])

let ctx: SessionLifecycleCtx

beforeEach(() => {
  flushed.length = 0
  capabilities.current = NATIVE
  exec.mockReset()
  getDriverOriginals().executeScript = exec as ReturnType<
    typeof getDriverOriginals
  >['executeScript']
})

afterEach(() => {
  ctx?.sessionCapturer?.cleanup()
  delete getDriverOriginals().executeScript
})

describe('selenium native network capture', () => {
  it('starts a listener through the unpatched executeScript for a native session that asked for it', async () => {
    exec.mockResolvedValueOnce('L1')
    ctx = makeCtx(true)
    await onDriverCreated(ctx, driver('d1'))
    expect(exec).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd1' }),
      'interceptor: startListening',
      {}
    )
    expect(ctx.sessionCapturer?.nativeNetwork.active).toBe(true)
  })

  it('stays off when the build did not ask, and for a session with a document', async () => {
    ctx = makeCtx(false)
    await onDriverCreated(ctx, driver('d1'))
    ctx.sessionCapturer?.cleanup()
    capabilities.current = { platformName: 'Android', browserName: 'chrome' }
    ctx = makeCtx(true)
    await onDriverCreated(ctx, driver('d1'))
    expect(exec).not.toHaveBeenCalled()
  })

  it('records what the proxy holds after each command', async () => {
    exec.mockResolvedValueOnce('L1').mockResolvedValue([ENTRY])
    ctx = makeCtx(true)
    await onDriverCreated(ctx, driver('d1'))
    resetSignatureCounters()
    const reporter = new TestReporter(vi.fn())
    const suiteManager = new SuiteManager(reporter)
    const root = suiteManager.getOrCreateRootSuite('app.spec.ts', 'Suite')
    const commandCtx = {
      sessionCapturer: ctx.sessionCapturer,
      testManager: new TestManager(root, reporter, suiteManager),
      retryTracker: new RetryTracker(),
      options: { captureScreenshots: false, mode: 'live' },
      finalized: false,
      driver: undefined,
      actionSnapshots: [] as ActionSnapshot[],
      snapshotCaptures: []
    } as unknown as OnCommandCtx
    const cmd: CapturedCommand = {
      command: 'getTitle',
      fromElement: false,
      args: [],
      timestamp: 0,
      startTime: 0,
      result: 'x',
      error: undefined,
      callSource: undefined
    }
    await handleOnCommand(commandCtx, cmd)
    await vi.waitFor(() =>
      expect(ctx.sessionCapturer?.networkRequests).toHaveLength(1)
    )
    expect(ctx.sessionCapturer?.networkRequests[0]?.id).toBe('interceptor-L1-0')
  })

  it('drains before the per-test slice is written', async () => {
    exec.mockResolvedValueOnce('L1').mockResolvedValue([ENTRY])
    ctx = makeCtx(true)
    await onDriverCreated(ctx, driver('d1'))
    await flushCurrentTestTrace(ctx)
    expect(ctx.sessionCapturer?.networkRequests).toHaveLength(1)
  })

  // Regression: the slice was chosen after the drain, so a boundary recorded meanwhile stole it.
  it('flushes the ended test even when the next boundary lands during the drain', async () => {
    exec.mockResolvedValueOnce('L1')
    ctx = makeCtx(true)
    ;(ctx.options as { traceGranularity?: string }).traceGranularity = 'test'
    await onDriverCreated(ctx, driver('d1'))
    const range = (testUid: string) => ({
      specFile: 'app.spec.ts',
      key: testUid,
      testUid,
      commandStartIdx: 0,
      consoleStartIdx: 0,
      networkStartIdx: 0,
      mutationStartIdx: 0
    })
    ctx.specRanges.push(range('test-a') as (typeof ctx.specRanges)[number])
    let answer!: (entries: unknown) => void
    exec.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    const pending = flushCurrentTestTrace(ctx)
    expect(ctx.traceFlushes).toHaveLength(1)
    ctx.specRanges.push(range('test-b') as (typeof ctx.specRanges)[number])
    answer([ENTRY])
    await pending
    expect(flushed).toEqual([expect.objectContaining({ testUid: 'test-a' })])
    expect(ctx.sessionCapturer?.networkRequests).toHaveLength(1)
  })

  it('reads the intercept flag the build of this driver asked for', async () => {
    exec.mockResolvedValueOnce('L1')
    ctx = makeCtx(false)
    const asked = driver('d1')
    ctx.interceptRequestedFor = (d) => d === asked
    await onDriverCreated(ctx, asked)
    expect(ctx.sessionCapturer?.nativeNetwork.active).toBe(true)
  })

  it('drains at driver end and reads nothing after the driver quit', async () => {
    exec.mockResolvedValueOnce('L1').mockResolvedValue([ENTRY])
    ctx = makeCtx(true)
    await onDriverCreated(ctx, driver('d1'))
    vi.spyOn(ctx.sessionCapturer!, 'captureTrace').mockResolvedValue()
    await onDriverEnd(ctx)
    expect(ctx.sessionCapturer?.networkRequests).toHaveLength(1)
    expect(ctx.sessionCapturer?.nativeNetwork.active).toBe(false)
  })

  it('starts a new listener on the next driver', async () => {
    exec.mockResolvedValueOnce('L1')
    ctx = makeCtx(true)
    await onDriverCreated(ctx, driver('d1'))
    vi.spyOn(ctx.sessionCapturer!, 'captureTrace').mockResolvedValue()
    exec.mockResolvedValueOnce([])
    await onDriverEnd(ctx)
    exec.mockResolvedValueOnce('L2')
    await onDriverCreated(ctx, driver('d2'))
    expect(scripts()).toEqual([
      ['d1', 'interceptor: startListening'],
      ['d1', 'interceptor: getInterceptedData'],
      ['d2', 'interceptor: startListening']
    ])
    expect(ctx.sessionCapturer?.nativeNetwork.active).toBe(true)
  })
})
