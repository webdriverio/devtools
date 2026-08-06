import { afterEach, describe, expect, it, vi } from 'vitest'

import { resetSignatureCounters } from '../src/helpers/utils.js'
import { TestManager } from '../src/helpers/testManager.js'
import { SuiteManager } from '../src/helpers/suiteManager.js'
import { TestReporter } from '../src/reporter.js'
import { SessionCapturer } from '../src/session.js'
import {
  handleOnCommand,
  type OnCommandCtx
} from '../src/helpers/commandPostActions.js'
import { RetryTracker } from '@wdio/devtools-core'
import type { ActionSnapshot } from '@wdio/devtools-shared'
import type { CapturedCommand, SeleniumDriverLike } from '../src/types.js'

const capturers: SessionCapturer[] = []

afterEach(() => {
  while (capturers.length) {
    capturers.pop()!.cleanup()
  }
})

/** A driver whose probes resolve to empty results — enough for the snapshot to
 *  be produced without a browser. The patcher's `originals` bag is empty here
 *  (nothing was patched), so the adapter falls back to these directly. */
function fakeDriver(): SeleniumDriverLike {
  return {
    executeScript: vi.fn().mockResolvedValue([]),
    takeScreenshot: vi.fn().mockResolvedValue('AA'),
    getCurrentUrl: vi.fn().mockResolvedValue('http://example.test/'),
    getTitle: vi.fn().mockResolvedValue('Example')
  } as unknown as SeleniumDriverLike
}

function makeCtx(driver: SeleniumDriverLike) {
  resetSignatureCounters()
  const reporter = new TestReporter(vi.fn())
  const suiteManager = new SuiteManager(reporter)
  const rootSuite = suiteManager.getOrCreateRootSuite('login.spec.ts', 'Suite')
  const testManager = new TestManager(rootSuite, reporter, suiteManager)
  const capturer = new SessionCapturer()
  capturers.push(capturer)

  const actionSnapshots: ActionSnapshot[] = []
  const snapshotCaptures: Promise<void>[] = []
  // Structural ctx: handleOnCommand reads only the capturer, test manager,
  // options, driver and the two snapshot accumulators.
  const ctx = {
    sessionCapturer: capturer,
    testManager,
    retryTracker: new RetryTracker(),
    options: { captureScreenshots: false, mode: 'trace' },
    scriptInjected: true,
    finalized: false,
    driver,
    actionSnapshots,
    snapshotCaptures,
    setScriptInjected: () => {}
  } as unknown as OnCommandCtx
  return { ctx, capturer, actionSnapshots, snapshotCaptures }
}

function cmd(overrides: Partial<CapturedCommand>): CapturedCommand {
  return {
    command: 'click',
    args: [],
    timestamp: 0,
    fromElement: true,
    result: undefined,
    error: undefined,
    callSource: undefined,
    ...overrides
  }
}

describe('selenium action-snapshot timestamp binding', () => {
  it("stamps the snapshot with the logged command's timestamp", async () => {
    // Regression: the capture resolves after the command completes, so its own
    // Date.now() never equals cmd.timestamp — and the exporter claims snapshots
    // by exact equality, so nothing bound and the trace carried no
    // frame-snapshot events at all.
    const { ctx, capturer, actionSnapshots, snapshotCaptures } =
      makeCtx(fakeDriver())

    await handleOnCommand(ctx, cmd({ command: 'click', timestamp: 12345 }))
    await Promise.all(snapshotCaptures)

    expect(actionSnapshots).toHaveLength(1)
    expect(actionSnapshots[0]!.timestamp).toBe(12345)
    expect(actionSnapshots[0]!.timestamp).toBe(
      capturer.commandsLog[0]!.timestamp
    )
  })

  it('does not capture for a non-mapped command', async () => {
    const { ctx, snapshotCaptures, actionSnapshots } = makeCtx(fakeDriver())
    await handleOnCommand(
      ctx,
      cmd({ command: 'findElement', timestamp: 500, fromElement: false })
    )
    await Promise.all(snapshotCaptures)
    expect(actionSnapshots).toHaveLength(0)
  })

  it('does not capture for a failed command', async () => {
    const { ctx, snapshotCaptures, actionSnapshots } = makeCtx(fakeDriver())
    await handleOnCommand(
      ctx,
      cmd({ command: 'click', timestamp: 500, error: new Error('boom') })
    )
    await Promise.all(snapshotCaptures)
    expect(actionSnapshots).toHaveLength(0)
  })
})
