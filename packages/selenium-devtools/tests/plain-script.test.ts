import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Socket } from 'node:net'

import { RetryTracker } from '@wdio/devtools-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'

import { SuiteManager } from '../src/helpers/suiteManager.js'
import { registerProcessHooks } from '../src/helpers/processHooks.js'
import { isRunnerless } from '../src/helpers/runtime.js'
import { TestReporter } from '../src/reporter.js'
import {
  onDriverEnd,
  onSessionEnd,
  type SessionLifecycleCtx
} from '../src/session-lifecycle.js'
import { SessionCapturer } from '../src/session.js'
import {
  ensureRunnerlessTracking,
  type TestManagementCtx
} from '../src/test-management.js'
import type { DetectedRunner, SuiteStats } from '../src/types.js'

function makeCtx(
  report: (data: Record<string, SuiteStats>[]) => void = vi.fn()
): TestManagementCtx {
  const testReporter = new TestReporter(report)
  return {
    retryTracker: new RetryTracker(),
    testReporter,
    sessionCapturer: undefined,
    suiteManager: new SuiteManager(testReporter),
    testManager: undefined,
    testFilePath: undefined,
    pendingTestActions: [],
    pendingScenario: null
  }
}

function makeLifecycleCtx(
  tmCtx: TestManagementCtx,
  detectedRunner: DetectedRunner = 'node'
): SessionLifecycleCtx {
  let finalized = false
  return {
    options: {
      hostname: '127.0.0.1',
      port: 3000,
      openUi: false,
      captureScreenshots: false,
      mode: 'live'
    },
    screencastOptions: { enabled: false, fps: 10, quality: 80 },
    detectedRunner,
    rerunTemplate: undefined,
    launchCommand: undefined,
    isReuse: true,
    get finalized() {
      return finalized
    },
    interceptRequestedFor: () => false,
    driver: undefined,
    sessionCapturer: tmCtx.sessionCapturer,
    testReporter: tmCtx.testReporter,
    suiteManager: tmCtx.suiteManager,
    testManager: tmCtx.testManager,
    screencast: undefined,
    sessionId: undefined,
    testFilePath: tmCtx.testFilePath,
    keepAliveTimer: undefined,
    actionSnapshots: [],
    snapshotCaptures: [],
    specRanges: [],
    flushedSpecs: new Set(),
    traceFlushes: [],
    artifacts: [],
    filmstripFrames: [],
    setFinalized: (v) => {
      finalized = v
    },
    ensureBackendStarted: async () => {},
    flushPendingTestActions: () => {},
    resetRetryTracker: () => tmCtx.retryTracker.reset(),
    clearKeepAlive: () => {}
  }
}

describe('a plain script that never calls startTest', () => {
  // Regression: only a start call created the TestManager, so a plain script dropped every command.
  it.each<DetectedRunner>(['unknown', 'node'])(
    'gets a session test under runner %s',
    (runner) => {
      const ctx = makeCtx()
      ensureRunnerlessTracking(ctx, runner)
      expect(ctx.testManager?.getOrEnsureTest()?.title).toBe('Selenium Session')
    }
  )

  it.each<DetectedRunner>(['mocha', 'jest', 'cucumber'])(
    'leaves %s to declare its own test boundaries',
    (runner) => {
      const ctx = makeCtx()
      ensureRunnerlessTracking(ctx, runner)
      expect(ctx.testManager).toBeUndefined()
      expect(isRunnerless(runner)).toBe(false)
    }
  )

  it.each<DetectedRunner>(['unknown', 'node'])(
    'closes the synthetic test and its suite when the driver quits under runner %s',
    async (runner) => {
      const updates: Record<string, SuiteStats>[][] = []
      const tmCtx = makeCtx((data) =>
        updates.push(structuredClone(data) as Record<string, SuiteStats>[])
      )
      ensureRunnerlessTracking(tmCtx, runner)
      const test = tmCtx.testManager!.getOrEnsureTest()!
      expect(test.state).toBe('running')
      expect(test.end).toBeNull()

      const lcCtx = makeLifecycleCtx(tmCtx, runner)
      await onDriverEnd(lcCtx)

      const root = tmCtx.suiteManager!.getRootSuite()!
      expect(test.state).toBe('passed')
      expect(test.end).toBeInstanceOf(Date)
      expect(root.state).toBe('passed')
      expect(root.end).toBeInstanceOf(Date)

      const lastSuite = Object.values(updates.at(-1)![0])[0]
      expect(lastSuite.state).toBe('passed')
      expect(lastSuite.end).not.toBeNull()
      expect((lastSuite.tests[0] as typeof test).state).toBe('passed')
      expect((lastSuite.tests[0] as typeof test).end).not.toBeNull()
    }
  )

  it('closes the synthetic test and its suite on onSessionEnd when quit was not called', async () => {
    const updates: Record<string, SuiteStats>[][] = []
    const tmCtx = makeCtx((data) =>
      updates.push(structuredClone(data) as Record<string, SuiteStats>[])
    )
    ensureRunnerlessTracking(tmCtx, 'node')
    const test = tmCtx.testManager!.getOrEnsureTest()!

    const lcCtx = makeLifecycleCtx(tmCtx, 'node')
    await onSessionEnd(lcCtx)

    const root = tmCtx.suiteManager!.getRootSuite()!
    expect(test.state).toBe('passed')
    expect(test.end).toBeInstanceOf(Date)
    expect(root.state).toBe('passed')
    expect(root.end).toBeInstanceOf(Date)

    const lastSuite = Object.values(updates.at(-1)![0])[0]
    expect(lastSuite.state).toBe('passed')
    expect(lastSuite.end).not.toBeNull()
    expect((lastSuite.tests[0] as typeof test).state).toBe('passed')
    expect((lastSuite.tests[0] as typeof test).end).not.toBeNull()
  })

  it('waits for onSessionEnd to finish before closing the worker socket on beforeExit', async () => {
    const order: string[] = []
    const beforeExitListenersBefore = new Set(process.listeners('beforeExit'))
    registerProcessHooks({
      isReuse: true,
      options: { port: 3000 },
      sessionCapturer: {
        closeWebSocket: async () => {
          order.push('closeWebSocket')
        },
        cleanup: () => {}
      },
      clearKeepAlive: () => {},
      onSessionEnd: async () => {
        await Promise.resolve()
        order.push('onSessionEnd')
      }
    })
    const added = process
      .listeners('beforeExit')
      .find((fn) => !beforeExitListenersBefore.has(fn))
    expect(added).toBeDefined()
    try {
      added!(0)
      await new Promise((r) => setImmediate(r))
      expect(order).toEqual(['onSessionEnd', 'closeWebSocket'])
    } finally {
      if (added) {
        process.removeListener('beforeExit', added)
      }
    }
  })
})

describe('the worker socket', () => {
  const servers: Array<() => Promise<void>> = []
  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(servers.splice(0).map((close) => close()))
  })

  async function backend(): Promise<number> {
    const server = createServer()
    const wss = new WebSocketServer({ server })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    servers.push(async () => {
      for (const c of wss.clients) {
        c.terminate()
      }
      wss.close()
      await new Promise((r) => server.close(r))
    })
    return (server.address() as AddressInfo).port
  }

  // Regression: a ref'd socket kept `beforeExit` from firing, so a finished plain script hung.
  it('does not hold the process open, but holds it while closing', async () => {
    const unref = vi.spyOn(Socket.prototype, 'unref')
    const ref = vi.spyOn(Socket.prototype, 'ref')
    const capturer = new SessionCapturer({
      hostname: '127.0.0.1',
      port: await backend()
    })
    await capturer.waitForConnection(2000)
    expect(unref).toHaveBeenCalled()

    await capturer.closeWebSocket()
    expect(ref).toHaveBeenCalled()
    capturer.cleanup()
  })
})
