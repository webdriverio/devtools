import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Socket } from 'node:net'

import { RetryTracker } from '@wdio/devtools-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'

import {
  registerProcessHooks,
  type ProcessHookPlugin
} from '../src/helpers/processHooks.js'
import { SuiteManager } from '../src/helpers/suiteManager.js'
import { isRunnerless } from '../src/helpers/runtime.js'
import { TestReporter } from '../src/reporter.js'
import { SessionCapturer } from '../src/session.js'
import {
  onDriverEnd,
  onSessionEnd,
  type SessionLifecycleCtx
} from '../src/session-lifecycle.js'
import {
  ensureRunnerlessTracking,
  type TestManagementCtx
} from '../src/test-management.js'
import type { DetectedRunner, SuiteStats } from '../src/types.js'

function makeCtx(): TestManagementCtx {
  const testReporter = new TestReporter(vi.fn())
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
})

const servers: Array<() => Promise<void>> = []

/** A backend that records, in order, every message the worker sends and when it closed. */
async function backend(events: string[] = []): Promise<number> {
  const server = createServer()
  const wss = new WebSocketServer({ server })
  wss.on('connection', (socket) => {
    socket.on('message', (raw) => events.push(String(raw)))
    socket.on('close', () => events.push('close'))
  })
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

describe('the worker socket', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await Promise.all(servers.splice(0).map((close) => close()))
  })

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

const PROCESS_EVENTS = ['exit', 'beforeExit', 'SIGINT', 'SIGTERM'] as const

/** Registers the hooks and hands back the beforeExit listener they added; afterEach removes all of them. */
function installProcessHooks(
  plugin: ProcessHookPlugin,
  installed: Array<[string, (...a: unknown[]) => void]>
): () => void {
  const before = new Map(
    PROCESS_EVENTS.map((e) => [e, new Set(process.listeners(e))])
  )
  registerProcessHooks(plugin)
  for (const e of PROCESS_EVENTS) {
    for (const l of process.listeners(e)) {
      if (!before.get(e)!.has(l)) {
        installed.push([e, l as (...a: unknown[]) => void])
      }
    }
  }
  return installed.find(([e]) => e === 'beforeExit')![1] as () => void
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

describe('the beforeExit hook', () => {
  const installed: Array<[string, (...a: unknown[]) => void]> = []
  afterEach(() => {
    for (const [event, listener] of installed.splice(0)) {
      process.removeListener(event, listener)
    }
  })

  function fakePlugin(sessionEnd: Promise<void>) {
    const closeWebSocket = vi.fn(async () => {})
    const plugin: ProcessHookPlugin = {
      isReuse: false,
      options: { port: 0 },
      sessionCapturer: { closeWebSocket, cleanup: vi.fn() },
      clearKeepAlive: vi.fn(),
      onSessionEnd: vi.fn(() => sessionEnd)
    }
    return { plugin, closeWebSocket }
  }

  // Regression: the close ran beside onSessionEnd, so the final suites update could miss the socket.
  it('closes the socket only once onSessionEnd has settled', async () => {
    const sessionEnd = deferred()
    const { plugin, closeWebSocket } = fakePlugin(sessionEnd.promise)
    const beforeExit = installProcessHooks(plugin, installed)

    beforeExit()
    await new Promise((r) => setImmediate(r))
    expect(closeWebSocket).not.toHaveBeenCalled()

    sessionEnd.resolve()
    await vi.waitFor(() => expect(closeWebSocket).toHaveBeenCalledTimes(1))
  })

  // Node re-emits beforeExit after the work the handler schedules; unguarded it would run forever.
  it('runs once however often Node emits it', async () => {
    const { plugin, closeWebSocket } = fakePlugin(Promise.resolve())
    const beforeExit = installProcessHooks(plugin, installed)

    beforeExit()
    await vi.waitFor(() => expect(closeWebSocket).toHaveBeenCalledTimes(1))
    beforeExit()
    beforeExit()
    await new Promise((r) => setImmediate(r))

    expect(plugin.onSessionEnd).toHaveBeenCalledTimes(1)
    expect(closeWebSocket).toHaveBeenCalledTimes(1)
  })
})

describe("a plain script's end", () => {
  const capturers: SessionCapturer[] = []
  const installed: Array<[string, (...a: unknown[]) => void]> = []
  afterEach(async () => {
    for (const [event, listener] of installed.splice(0)) {
      process.removeListener(event, listener)
    }
    for (const c of capturers.splice(0)) {
      await c.closeWebSocket()
      c.cleanup()
    }
    await Promise.all(servers.splice(0).map((close) => close()))
  })

  async function lifecycle(port?: number) {
    const capturer = new SessionCapturer(
      port === undefined ? {} : { hostname: '127.0.0.1', port }
    )
    capturers.push(capturer)
    if (port !== undefined) {
      await capturer.waitForConnection(2000)
    }
    const reporter = new TestReporter((suites) =>
      capturer.sendUpstream('suites', suites)
    )
    const tm = makeCtx()
    let finalized = false
    // Only the fields a live, runnerless onSessionEnd reads; the rest of the bag is irrelevant here.
    const ctx = {
      ...tm,
      testReporter: reporter,
      suiteManager: new SuiteManager(reporter),
      sessionCapturer: capturer,
      options: { hostname: '127.0.0.1', port: 0, openUi: false },
      detectedRunner: 'node',
      isReuse: false,
      get finalized() {
        return finalized
      },
      setFinalized: (v: boolean) => {
        finalized = v
      },
      resetRetryTracker: vi.fn(),
      actionSnapshots: [],
      snapshotCaptures: [],
      traceFlushes: [],
      specRanges: [],
      flushedSpecs: new Set<string>(),
      artifacts: [],
      filmstripFrames: []
    } as unknown as SessionLifecycleCtx & TestManagementCtx
    ensureRunnerlessTracking(ctx, 'node')
    const root = () => ctx.suiteManager!.getRootSuite()!
    return { ctx, capturer, root }
  }

  // Regression: the session test and its root suite stayed `running` with `end: null`.
  it('closes the session test and its suite, and sends that before the socket closes', async () => {
    const events: string[] = []
    const { ctx, capturer, root } = await lifecycle(await backend(events))
    const test = ctx.testManager!.getOrEnsureTest()!
    await onDriverEnd(ctx)
    expect(test.end).toBeFalsy()

    const beforeExit = installProcessHooks(
      {
        isReuse: false,
        options: { port: 0 },
        sessionCapturer: capturer,
        clearKeepAlive: vi.fn(),
        onSessionEnd: () => onSessionEnd(ctx)
      },
      installed
    )
    beforeExit()
    await vi.waitFor(() => expect(events.at(-1)).toBe('close'))

    expect(test.state).toBe('passed')
    expect(test.end).toBeTruthy()
    expect(root().end).toBeTruthy()
    expect(root().state).toBe('passed')
    const suites = events
      .slice(0, -1)
      .map((e) => JSON.parse(e) as { scope: string; data: unknown })
      .filter((m) => m.scope === 'suites')
    const last = suites.at(-1)!.data as Array<Record<string, SuiteStats>>
    const sent = last.find((s) => s[root().uid])![root().uid]
    expect(sent.end).toBeTruthy()
    expect(sent.tests).toMatchObject([{ uid: test.uid, state: 'passed' }])
  })

  // One script is one test: a second driver must neither open a second test nor reuse a closed one's uid.
  it('keeps one session test across drivers built one after another', async () => {
    const { ctx, root } = await lifecycle()
    const first = ctx.testManager!.getOrEnsureTest()
    await onDriverEnd(ctx)
    const second = ctx.testManager!.getOrEnsureTest()
    await onDriverEnd(ctx)
    await onSessionEnd(ctx)

    expect(second).toBe(first)
    expect(ctx.testManager!.getOrEnsureTest()).toBeNull()
    expect(root().tests).toHaveLength(1)
    expect(root().end).toBeTruthy()
  })

  it("leaves a test the script started to the script's own endTest", async () => {
    const { ctx, root } = await lifecycle()
    const test = ctx.testManager!.startMarkedTest('checkout')
    await onDriverEnd(ctx)
    ctx.testManager!.endCurrent('failed')
    await onSessionEnd(ctx)

    expect(test.state).toBe('failed')
    expect(root().tests).toEqual([test])
    expect(root().state).toBe('failed')
  })
})
