import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Socket } from 'node:net'

import { RetryTracker } from '@wdio/devtools-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'

import { SuiteManager } from '../src/helpers/suiteManager.js'
import { isRunnerless } from '../src/helpers/runtime.js'
import { TestReporter } from '../src/reporter.js'
import { SessionCapturer } from '../src/session.js'
import {
  ensureRunnerlessTracking,
  type TestManagementCtx
} from '../src/test-management.js'
import type { DetectedRunner } from '../src/types.js'

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
