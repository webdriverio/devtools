import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as DevToolsCore from '@wdio/devtools-core'
import type * as BidiModule from '../src/bidi.js'
import { NativeNetworkCapture, RetryTracker } from '@wdio/devtools-core'
import type { ActionSnapshot } from '@wdio/devtools-shared'

import { resetSignatureCounters } from '../src/helpers/utils.js'
import { TestManager } from '../src/helpers/testManager.js'
import { SuiteManager } from '../src/helpers/suiteManager.js'
import { TestReporter } from '../src/reporter.js'
import { SessionCapturer } from '../src/session.js'
import {
  onDriverCreated,
  onSessionEnd,
  type SessionLifecycleCtx
} from '../src/session-lifecycle.js'
import {
  handleOnCommand,
  type OnCommandCtx
} from '../src/helpers/commandPostActions.js'
import { captureFinalFrame } from '../src/helpers/finalFrame.js'
import type {
  CapturedCommand,
  DevToolsMode,
  SeleniumDriverLike
} from '../src/types.js'

const finalizeTraceExport = vi.hoisted(() => vi.fn(async () => []))
const registerCollectorPreload = vi.hoisted(() =>
  vi.fn(async () => true as boolean)
)
const attachBidiHandlers = vi.hoisted(() => vi.fn(async () => true))

vi.mock('@wdio/devtools-core', async (importOriginal) => ({
  ...(await importOriginal<typeof DevToolsCore>()),
  finalizeTraceExport,
  registerCollectorPreload
}))

vi.mock('../src/bidi.js', async (importOriginal) => ({
  ...(await importOriginal<typeof BidiModule>()),
  attachBidiHandlers
}))

const SESSION_ID = 'sess-abcd1234ef'
const capturers: SessionCapturer[] = []

afterEach(() => {
  while (capturers.length) {
    capturers.pop()!.cleanup()
  }
  vi.clearAllMocks()
})

function makeCapturer() {
  const capturer = new SessionCapturer()
  capturer.metadata = { sessionId: SESSION_ID } as SessionCapturer['metadata']
  capturers.push(capturer)
  const drains = {
    liveDrain: vi.spyOn(capturer, 'drainAfterLiveCommand').mockResolvedValue(),
    traceDrain: vi.spyOn(capturer, 'captureTrace').mockResolvedValue(),
    reinject: vi.spyOn(capturer, 'reinjectIfNavigated').mockResolvedValue()
  }
  return { capturer, ...drains }
}

function makeSessionEndCtx(mode: DevToolsMode, capturer: SessionCapturer) {
  return {
    options: {
      hostname: 'localhost',
      port: 3000,
      openUi: true,
      captureScreenshots: false,
      mode,
      traceFormat: 'zip',
      traceGranularity: 'session',
      tracePolicy: 'on',
      filmstrip: false,
      video: 'off',
      emitArtifactsManifest: false
    },
    screencastOptions: { enabled: false },
    driver: {},
    sessionCapturer: capturer,
    finalized: false,
    isReuse: false,
    testFilePath: '/specs/login.spec.ts',
    artifacts: [],
    actionSnapshots: [] as ActionSnapshot[],
    snapshotCaptures: [] as Promise<void>[],
    traceFlushes: [] as Promise<unknown>[],
    filmstripFrames: [],
    specRanges: [],
    flushedSpecs: new Set<string>(),
    setFinalized: vi.fn(),
    resetRetryTracker: vi.fn()
  } as unknown as SessionLifecycleCtx
}

function makeCommandCtx(mode: DevToolsMode, capturer: SessionCapturer) {
  resetSignatureCounters()
  const reporter = new TestReporter(vi.fn())
  const suiteManager = new SuiteManager(reporter)
  const rootSuite = suiteManager.getOrCreateRootSuite('login.spec.ts', 'Suite')
  const testManager = new TestManager(rootSuite, reporter, suiteManager)
  const snapshotCaptures: Promise<void>[] = []
  const ctx = {
    sessionCapturer: capturer,
    testManager,
    retryTracker: new RetryTracker(),
    options: { captureScreenshots: false, mode },
    finalized: false,
    driver: undefined,
    actionSnapshots: [] as ActionSnapshot[],
    snapshotCaptures
  } as unknown as OnCommandCtx
  return { ctx, snapshotCaptures }
}

function cmd(overrides: Partial<CapturedCommand>): CapturedCommand {
  return {
    command: 'sendKeys',
    args: [],
    timestamp: 0,
    startTime: 0,
    fromElement: true,
    result: undefined,
    error: undefined,
    callSource: undefined,
    ...overrides
  }
}

describe('telemetry mode: session end', () => {
  it('reaches the finalizer so the manifest is written, with no per-action capture', async () => {
    const { capturer, liveDrain, traceDrain } = makeCapturer()
    const ctx = makeSessionEndCtx('telemetry', capturer)

    await onSessionEnd(ctx)

    expect(finalizeTraceExport).toHaveBeenCalledTimes(1)
    expect(finalizeTraceExport).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'telemetry' })
    )
    expect(traceDrain).not.toHaveBeenCalled()
    expect(liveDrain).not.toHaveBeenCalled()
  })

  it('still runs the trace-mode end-of-session capture', async () => {
    const { capturer, traceDrain } = makeCapturer()
    const ctx = makeSessionEndCtx('trace', capturer)

    await onSessionEnd(ctx)

    expect(traceDrain).toHaveBeenCalledWith(true)
    expect(finalizeTraceExport).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'trace' })
    )
  })
})

describe('telemetry mode: command capture', () => {
  it.each([['sendKeys'], ['click'], ['clear']])(
    'takes no DOM drain after %s',
    async (command) => {
      const { capturer, liveDrain, traceDrain, reinject } = makeCapturer()
      const { ctx, snapshotCaptures } = makeCommandCtx('telemetry', capturer)

      await handleOnCommand(ctx, cmd({ command }))
      await Promise.all(snapshotCaptures)

      expect(liveDrain).not.toHaveBeenCalled()
      expect(traceDrain).not.toHaveBeenCalled()
      expect(reinject).not.toHaveBeenCalled()
    }
  )

  it('takes no end-of-test frame', async () => {
    const captureEndFrame = vi.fn(async () => {})
    const ctx = {
      options: { mode: 'telemetry' },
      finalized: false,
      driver: {},
      sessionCapturer: { testCapture: { captureEndFrame } }
    } as unknown as Parameters<typeof captureFinalFrame>[0]

    await captureFinalFrame(ctx)

    expect(captureEndFrame).not.toHaveBeenCalled()
  })
})

describe('telemetry mode: no page injection, preload or BiDi attach', () => {
  function makeLifecycleCtx(mode: DevToolsMode): SessionLifecycleCtx {
    return {
      options: { hostname: 'localhost', port: 0, mode },
      screencastOptions: {},
      detectedRunner: 'mocha',
      finalized: false,
      interceptRequestedFor: () => true,
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

  it.each([
    ['telemetry', false],
    ['trace', true]
  ] as const)(
    '%s: driver bringup patches stdout: %s',
    async (mode, patched) => {
      vi.spyOn(NativeNetworkCapture.prototype, 'start').mockResolvedValue()
      const write = process.stdout.write
      const ctx = makeLifecycleCtx(mode)

      await onDriverCreated(ctx, { id: 'd' } as unknown as SeleniumDriverLike)

      expect(process.stdout.write !== write).toBe(patched)
      ctx.sessionCapturer?.cleanup()
    }
  )

  it.each([
    ['telemetry', 0],
    ['trace', 1]
  ] as const)(
    '%s: driver bringup registers the preload, attaches BiDi and starts native network %i time(s)',
    async (mode, expected) => {
      const start = vi
        .spyOn(NativeNetworkCapture.prototype, 'start')
        .mockResolvedValue()
      const ctx = makeLifecycleCtx(mode)

      await onDriverCreated(ctx, { id: 'd' } as unknown as SeleniumDriverLike)

      expect(registerCollectorPreload).toHaveBeenCalledTimes(expected)
      expect(attachBidiHandlers).toHaveBeenCalledTimes(expected)
      expect(start).toHaveBeenCalledTimes(expected)
      ctx.sessionCapturer?.cleanup()
    }
  )

  it.each([
    ['telemetry', 0],
    ['trace', 1]
  ] as const)(
    '%s: a navigation injects no collector and logs no command row (%i)',
    async (mode, expected) => {
      const { capturer } = makeCapturer()
      const inject = vi.spyOn(capturer, 'injectScript').mockResolvedValue()
      const { ctx, snapshotCaptures } = makeCommandCtx(mode, capturer)

      await handleOnCommand(ctx, cmd({ command: 'get', fromElement: false }))
      await Promise.all(snapshotCaptures)

      expect(inject).toHaveBeenCalledTimes(expected)
      expect(capturer.commandsLog.length).toBe(expected)
    }
  )
})
