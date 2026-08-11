import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RetryTracker } from '@wdio/devtools-core'
import type * as DevToolsCore from '@wdio/devtools-core'
import type { ActionSnapshot } from '@wdio/devtools-shared'
import { getDriverOriginals } from '../src/driverPatcher.js'
import { resetSignatureCounters } from '../src/helpers/utils.js'
import { TestManager } from '../src/helpers/testManager.js'
import { SuiteManager } from '../src/helpers/suiteManager.js'
import { TestReporter } from '../src/reporter.js'
import { SessionCapturer } from '../src/session.js'
import {
  captureNavigationTrace,
  handleOnCommand,
  type OnCommandCtx
} from '../src/helpers/commandPostActions.js'
import { onDriverCreated } from '../src/session-lifecycle.js'
import type { SessionLifecycleCtx } from '../src/session-lifecycle.js'
import type { CapturedCommand, SeleniumDriverLike } from '../src/types.js'

const registerCollectorPreload = vi.hoisted(() =>
  vi.fn(async () => true as boolean)
)

vi.mock('@wdio/devtools-core', async (importOriginal) => ({
  ...(await importOriginal<typeof DevToolsCore>()),
  registerCollectorPreload
}))

const capturers: SessionCapturer[] = []

function makeCapturer(preloadRegistered: boolean): SessionCapturer {
  const capturer = new SessionCapturer({}, { id: 'd' } as never)
  capturer.preloadRegistered = preloadRegistered
  capturers.push(capturer)
  return capturer
}

afterEach(() => {
  while (capturers.length) {
    capturers.pop()!.cleanup()
  }
  vi.restoreAllMocks()
})

describe('captureNavigationTrace injection', () => {
  // Regression: the `<script>` append only instruments the document loaded when
  // it runs, so its readiness poll raced the first keystrokes on every fresh
  // page. With the collector registered at document-start there is nothing to
  // inject, and probing for it is a wasted round trip on the anchor path.
  it('skips the `<script>` injection when the preload is registered', async () => {
    const capturer = makeCapturer(true)
    const inject = vi.spyOn(capturer, 'injectScript').mockResolvedValue()
    const drain = vi.spyOn(capturer, 'captureTrace').mockResolvedValue()

    captureNavigationTrace(capturer, () => false)
    await vi.waitFor(() => expect(drain).toHaveBeenCalledWith(true))
    expect(inject).not.toHaveBeenCalled()
  })

  it('injects before draining when the preload is unavailable', async () => {
    const capturer = makeCapturer(false)
    const order: string[] = []
    vi.spyOn(capturer, 'injectScript').mockImplementation(async () => {
      order.push('inject')
    })
    vi.spyOn(capturer, 'captureTrace').mockImplementation(async () => {
      order.push('drain')
    })

    captureNavigationTrace(capturer, () => false)
    await vi.waitFor(() => expect(order).toEqual(['inject', 'drain']))
  })
})

describe('captureNavigationTrace ordering against the performance read', () => {
  let restoreExec: (() => void) | undefined

  beforeEach(() => {
    const originals = getDriverOriginals()
    const previous = originals.executeScript
    restoreExec = () => {
      if (previous) {
        originals.executeScript = previous
      } else {
        delete originals.executeScript
      }
    }
  })

  afterEach(() => {
    restoreExec?.()
    restoreExec = undefined
  })

  // The performance read sits on a 500ms settle; running it first delayed the
  // drain that moves the destination's DOM anchor out of the page, and a
  // short-lived page can be gone by then. Perf entries only get more complete
  // with time — the anchor does not.
  it('drains the collector before reading the Performance API', async () => {
    const capturer = makeCapturer(true)
    const order: string[] = []
    vi.spyOn(capturer, 'captureTrace').mockImplementation(async () => {
      order.push('drain')
    })
    getDriverOriginals().executeScript = (async () => {
      order.push('perf')
      return {}
    }) as ReturnType<typeof getDriverOriginals>['executeScript']

    captureNavigationTrace(
      capturer,
      () => false,
      { command: 'get', args: [], timestamp: 1 },
      ['https://example.com'],
      { id: 'd' } as unknown as SeleniumDriverLike
    )
    await vi.waitFor(() => expect(order).toEqual(['drain', 'perf']), {
      timeout: 4000
    })
  })
})

describe('post-command re-injection', () => {
  function makeCtx(capturer: SessionCapturer) {
    resetSignatureCounters()
    const reporter = new TestReporter(vi.fn())
    const suiteManager = new SuiteManager(reporter)
    const rootSuite = suiteManager.getOrCreateRootSuite(
      'login.spec.ts',
      'Suite'
    )
    const snapshotCaptures: Promise<void>[] = []
    return {
      ctx: {
        sessionCapturer: capturer,
        testManager: new TestManager(rootSuite, reporter, suiteManager),
        retryTracker: new RetryTracker(),
        options: { captureScreenshots: false, mode: 'trace' },
        finalized: false,
        driver: undefined,
        actionSnapshots: [] as ActionSnapshot[],
        snapshotCaptures
      } as unknown as OnCommandCtx,
      snapshotCaptures
    }
  }

  const cmd: CapturedCommand = {
    command: 'sendKeys',
    args: [],
    timestamp: 0,
    startTime: 0,
    fromElement: true,
    result: undefined,
    error: undefined,
    callSource: undefined
  }

  // A missing collector is the fallback path's only signal that the document
  // was replaced; the preload makes that signal permanently false, so the probe
  // can only ever cost a round trip.
  it('skips reinjectIfNavigated when the preload is registered', async () => {
    const capturer = makeCapturer(true)
    const drain = vi.spyOn(capturer, 'captureTrace').mockResolvedValue()
    const reinject = vi
      .spyOn(capturer, 'reinjectIfNavigated')
      .mockResolvedValue()
    const { ctx, snapshotCaptures } = makeCtx(capturer)

    await handleOnCommand(ctx, cmd)
    await Promise.all(snapshotCaptures)

    expect(drain).toHaveBeenCalledWith(true)
    expect(reinject).not.toHaveBeenCalled()
  })

  it('still re-injects after a navigation when the preload is unavailable', async () => {
    const capturer = makeCapturer(false)
    vi.spyOn(capturer, 'captureTrace').mockResolvedValue()
    const reinject = vi
      .spyOn(capturer, 'reinjectIfNavigated')
      .mockResolvedValue()
    const { ctx, snapshotCaptures } = makeCtx(capturer)

    await handleOnCommand(ctx, cmd)
    await Promise.all(snapshotCaptures)

    expect(reinject).toHaveBeenCalledTimes(1)
  })
})

describe('per-driver preload registration', () => {
  function makeLifecycleCtx(): SessionLifecycleCtx {
    return {
      options: { hostname: 'localhost', port: 0, mode: 'trace' },
      screencastOptions: {},
      detectedRunner: 'mocha',
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

  it('marks the capturer once the collector is registered at document-start', async () => {
    registerCollectorPreload.mockResolvedValueOnce(true)
    const ctx = makeLifecycleCtx()

    await onDriverCreated(ctx, { id: 'd' } as unknown as SeleniumDriverLike)

    expect(registerCollectorPreload).toHaveBeenCalled()
    expect(ctx.sessionCapturer?.preloadRegistered).toBe(true)
    ctx.sessionCapturer?.cleanup()
  })

  // A session created without `webSocketUrl` has no BiDi channel, so the
  // script manager throws and the adapter has to stay on the `<script>` path
  // rather than silently capturing nothing.
  it('leaves the capturer on the `<script>` path when BiDi is unavailable', async () => {
    registerCollectorPreload.mockResolvedValueOnce(false)
    const ctx = makeLifecycleCtx()

    await onDriverCreated(ctx, { id: 'd' } as unknown as SeleniumDriverLike)

    expect(ctx.sessionCapturer?.preloadRegistered).toBe(false)
    ctx.sessionCapturer?.cleanup()
  })
})
