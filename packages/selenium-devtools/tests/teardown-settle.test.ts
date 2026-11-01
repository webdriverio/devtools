import { afterEach, describe, expect, it, vi } from 'vitest'
import { PENDING_SETTLE_TIMEOUT_MS, RetryTracker } from '@wdio/devtools-core'
import { getDriverOriginals } from '../src/driverPatcher.js'
import {
  handleOnCommand,
  type OnCommandCtx
} from '../src/helpers/commandPostActions.js'
import { SuiteManager } from '../src/helpers/suiteManager.js'
import { TestManager } from '../src/helpers/testManager.js'
import { TestReporter } from '../src/reporter.js'
import { SessionCapturer } from '../src/session.js'
import {
  onDriverEnd,
  type SessionLifecycleCtx
} from '../src/session-lifecycle.js'

// Regression: the last commands' row screenshots ran into driver.quit() and failed against a stopped Appium server.

function deferred<T = void>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const capturers: SessionCapturer[] = []
function makeCapturer(driver: object = { id: 'd1' }) {
  const capturer = new SessionCapturer({}, driver as never)
  capturers.push(capturer)
  return capturer
}

function stubScreenshot(impl: () => Promise<string>) {
  const fn = vi.fn(impl)
  getDriverOriginals().takeScreenshot = fn
  return fn
}

afterEach(() => {
  vi.useRealTimers()
  delete getDriverOriginals().takeScreenshot
  capturers.splice(0).forEach((c) => c.cleanup())
})

describe('selenium SessionCapturer.settleBeforeQuit', () => {
  it('waits for tracked work, including work tracked while waiting', async () => {
    const capturer = makeCapturer()
    const first = deferred()
    const second = deferred()
    capturer.track(first.promise.then(() => capturer.track(second.promise)))

    let settled = false
    const settling = capturer.settleBeforeQuit().then(() => (settled = true))
    first.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(settled).toBe(false)

    second.resolve()
    await settling
    expect(settled).toBe(true)
  })

  it('gives up at the ceiling', async () => {
    vi.useFakeTimers()
    const capturer = makeCapturer()
    capturer.track(new Promise(() => {}))
    const settling = capturer.settleBeforeQuit()
    await vi.advanceTimersByTimeAsync(PENDING_SETTLE_TIMEOUT_MS)
    await expect(settling).resolves.toBeUndefined()

    capturer.setDriver({ id: 'd2' } as never)
    await expect(capturer.settleBeforeQuit()).resolves.toBeUndefined()
  })

  it('skips screenshots for the driver being quit, not for the next one', async () => {
    const shoot = stubScreenshot(async () => 'png')
    const capturer = makeCapturer()
    await capturer.settleBeforeQuit()
    expect(await capturer.takeScreenshot()).toBeNull()
    expect(shoot).not.toHaveBeenCalled()

    capturer.setDriver({ id: 'd2' } as never)
    expect(await capturer.takeScreenshot()).toBe('png')
  })
})

describe('selenium row screenshot', () => {
  it('is tracked, so quit waits for it', async () => {
    const shot = deferred<string>()
    stubScreenshot(() => shot.promise)
    const capturer = makeCapturer()
    const reporter = new TestReporter(vi.fn())
    const suiteManager = new SuiteManager(reporter)
    const root = suiteManager.getOrCreateRootSuite('app.spec.ts', 'Suite')
    await handleOnCommand(
      {
        sessionCapturer: capturer,
        testManager: new TestManager(root, reporter, suiteManager),
        retryTracker: new RetryTracker(),
        options: { captureScreenshots: true, mode: 'live' },
        finalized: false,
        driver: undefined,
        actionSnapshots: [],
        snapshotCaptures: []
      } as unknown as OnCommandCtx,
      {
        command: 'getTitle',
        fromElement: false,
        args: [],
        timestamp: 0,
        startTime: 0,
        result: 'x',
        error: undefined,
        callSource: undefined
      }
    )

    let settled = false
    const settling = capturer.settleBeforeQuit().then(() => (settled = true))
    await new Promise((r) => setTimeout(r, 0))
    expect(settled).toBe(false)

    shot.resolve('png')
    await settling
    expect(capturer.commandsLog[0]?.screenshot).toBe('png')
  })
})

describe('selenium onDriverEnd', () => {
  it('settles in-flight work before it touches the session', async () => {
    const order: string[] = []
    const ctx = {
      options: { mode: 'live' },
      driver: { id: 'd1' },
      sessionCapturer: {
        settleBeforeQuit: vi.fn(async () => void order.push('settle')),
        nativeNetwork: {
          forward: vi.fn(async () => void order.push('drain')),
          stop: vi.fn()
        },
        drainAfterLiveCommand: vi.fn(async () => {})
      },
      filmstripFrames: [],
      resetRetryTracker: vi.fn()
    } as unknown as SessionLifecycleCtx
    await onDriverEnd(ctx)
    expect(order).toEqual(['settle', 'drain'])
  })
})
