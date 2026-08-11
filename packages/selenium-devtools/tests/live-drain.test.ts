import { afterEach, describe, expect, it, vi } from 'vitest'

import { RetryTracker } from '@wdio/devtools-core'
import type { ActionSnapshot } from '@wdio/devtools-shared'
import { resetSignatureCounters } from '../src/helpers/utils.js'
import { TestManager } from '../src/helpers/testManager.js'
import { SuiteManager } from '../src/helpers/suiteManager.js'
import { TestReporter } from '../src/reporter.js'
import { SessionCapturer } from '../src/session.js'
import {
  handleOnCommand,
  type OnCommandCtx
} from '../src/helpers/commandPostActions.js'
import type { CapturedCommand, DevToolsMode } from '../src/types.js'

const capturers: SessionCapturer[] = []

afterEach(() => {
  while (capturers.length) {
    capturers.pop()!.cleanup()
  }
})

function makeCtx(mode: DevToolsMode) {
  resetSignatureCounters()
  const reporter = new TestReporter(vi.fn())
  const suiteManager = new SuiteManager(reporter)
  const rootSuite = suiteManager.getOrCreateRootSuite('login.spec.ts', 'Suite')
  const testManager = new TestManager(rootSuite, reporter, suiteManager)
  const capturer = new SessionCapturer()
  capturers.push(capturer)

  // The drain itself needs a real browser; only the decision is under test.
  const liveDrain = vi
    .spyOn(capturer, 'drainAfterLiveCommand')
    .mockResolvedValue()
  const traceDrain = vi.spyOn(capturer, 'captureTrace').mockResolvedValue()
  const reinject = vi.spyOn(capturer, 'reinjectIfNavigated').mockResolvedValue()

  const snapshotCaptures: Promise<void>[] = []
  const ctx = {
    sessionCapturer: capturer,
    testManager,
    retryTracker: new RetryTracker(),
    options: { captureScreenshots: false, mode },
    finalized: false,
    // No driver: keeps the trace-mode per-action snapshot path out of the way.
    driver: undefined,
    actionSnapshots: [] as ActionSnapshot[],
    snapshotCaptures
  } as unknown as OnCommandCtx

  return { ctx, snapshotCaptures, liveDrain, traceDrain, reinject }
}

function cmd(overrides: Partial<CapturedCommand>): CapturedCommand {
  return {
    command: 'click',
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

describe('selenium live-mode DOM drain', () => {
  // Regression: live mode reconstructs the DOM purely from the mutation stream
  // and only the navigation hook drained it, so every row between two document
  // loads replayed the page as it loaded — an unfilled form after sendKeys, and
  // the destination of a navigating click never anchored at all.
  it.each([
    ['sendKeys', true],
    ['click', true],
    ['clear', true],
    ['getText', true],
    ['getCurrentUrl', false]
  ])('drains after %s', async (command, fromElement) => {
    const { ctx, snapshotCaptures, liveDrain } = makeCtx('live')
    await handleOnCommand(ctx, cmd({ command, fromElement }))
    await Promise.all(snapshotCaptures)
    expect(liveDrain).toHaveBeenCalledTimes(1)
  })

  it.each([
    // Already drained (and re-anchored) by captureNavigationTrace.
    ['get', false],
    ['refresh', false],
    // Resolving a locator cannot change the DOM.
    ['findElement', false],
    ['findElements', false],
    // A node:assert row never reaches the browser.
    ['assert.equal', false]
  ])('does not drain after %s', async (command, fromElement) => {
    const { ctx, snapshotCaptures, liveDrain } = makeCtx('live')
    await handleOnCommand(ctx, cmd({ command, fromElement }))
    await Promise.all(snapshotCaptures)
    expect(liveDrain).not.toHaveBeenCalled()
  })

  it('leaves trace mode on its own pre-navigation flush', async () => {
    const { ctx, snapshotCaptures, liveDrain, traceDrain, reinject } =
      makeCtx('trace')
    await handleOnCommand(ctx, cmd({ command: 'sendKeys', fromElement: true }))
    await Promise.all(snapshotCaptures)

    expect(liveDrain).not.toHaveBeenCalled()
    expect(traceDrain).toHaveBeenCalledWith(true)
    expect(reinject).toHaveBeenCalledTimes(1)
  })

  it('takes no drain at all in trace mode for a read', async () => {
    const { ctx, snapshotCaptures, liveDrain, traceDrain } = makeCtx('trace')
    await handleOnCommand(ctx, cmd({ command: 'getText', fromElement: true }))
    await Promise.all(snapshotCaptures)

    expect(liveDrain).not.toHaveBeenCalled()
    expect(traceDrain).not.toHaveBeenCalled()
  })

  it('skips the drain once the session is finalized', async () => {
    const { ctx, snapshotCaptures, liveDrain } = makeCtx('live')
    ;(ctx as { finalized: boolean }).finalized = true
    await handleOnCommand(ctx, cmd({ command: 'sendKeys', fromElement: true }))
    await Promise.all(snapshotCaptures)
    expect(liveDrain).not.toHaveBeenCalled()
  })
})

describe('SessionCapturer.drainAfterLiveCommand', () => {
  it('serializes drains so their batches stay in issue order', async () => {
    // The driver patcher does not await onCommand, so overlapping drains can
    // push their batches out of timestamp order — and the dashboard stops
    // replaying at the first entry past the selected row's window.
    const capturer = new SessionCapturer()
    capturers.push(capturer)

    const order: string[] = []
    let release: (() => void) | undefined
    vi.spyOn(capturer, 'captureTrace').mockImplementation(async () => {
      order.push(`start${order.length}`)
      if (!release) {
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
    })

    const first = capturer.drainAfterLiveCommand()
    const second = capturer.drainAfterLiveCommand()
    await Promise.resolve()
    expect(order).toEqual(['start0'])

    release!()
    await Promise.all([first, second])
    expect(order).toEqual(['start0', 'start1'])
  })

  it('swallows a drain failure so the next one still runs', async () => {
    const capturer = new SessionCapturer()
    capturers.push(capturer)
    const trace = vi
      .spyOn(capturer, 'captureTrace')
      .mockRejectedValueOnce(new Error('no such session'))
      .mockResolvedValue()

    await expect(capturer.drainAfterLiveCommand()).resolves.toBeUndefined()
    await expect(capturer.drainAfterLiveCommand()).resolves.toBeUndefined()
    expect(trace).toHaveBeenCalledTimes(2)
  })
})
