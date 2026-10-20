import type * as DevtoolsCore from '@wdio/devtools-core'
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
import { captureActionSnapshot } from '../src/action-snapshot.js'
import { getDriverOriginals } from '../src/driverPatcher.js'
import {
  RetryTracker,
  captureActionSnapshot as coreCapture
} from '@wdio/devtools-core'
import type { ActionSnapshot } from '@wdio/devtools-shared'
import type { CapturedCommand, SeleniumDriverLike } from '../src/types.js'

vi.mock('@wdio/devtools-core', async (importOriginal) => {
  const actual = await importOriginal<typeof DevtoolsCore>()
  return {
    ...actual,
    captureActionSnapshot: vi.fn(actual.captureActionSnapshot)
  }
})

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
    finalized: false,
    driver,
    actionSnapshots,
    snapshotCaptures
  } as unknown as OnCommandCtx
  return { ctx, capturer, actionSnapshots, snapshotCaptures }
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

describe('selenium action-snapshot capture gate', () => {
  async function run(commands: string[], ctxBag = makeCtx(fakeDriver())) {
    let t = 1
    for (const command of commands) {
      await handleOnCommand(ctxBag.ctx, cmd({ command, timestamp: t++ }))
    }
    await Promise.all(ctxBag.snapshotCaptures)
    return ctxBag
  }

  it('captures a click, but not a read or wait that follows it', async () => {
    const { actionSnapshots } = await run([
      'click',
      'getText',
      'waitForDisplayed'
    ])
    expect(actionSnapshots.map((s) => s.timestamp)).toEqual([1])
  })

  it('captures a leading read as the initial frame, once per test', async () => {
    const bag = makeCtx(fakeDriver())
    await run(['getText', 'isDisplayed'], bag)
    expect(bag.actionSnapshots.map((s) => s.timestamp)).toEqual([1])

    bag.capturer.resetTestCapture()
    await handleOnCommand(bag.ctx, cmd({ command: 'getText', timestamp: 9 }))
    await Promise.all(bag.snapshotCaptures)
    expect(bag.actionSnapshots.map((s) => s.timestamp)).toEqual([1, 9])
  })

  it('retries the initial frame when the first read captures nothing', async () => {
    vi.mocked(coreCapture).mockResolvedValueOnce(null)
    const bag = await run(['getText', 'isDisplayed', 'getText'])
    expect(bag.actionSnapshots.map((s) => s.timestamp)).toEqual([2])
  })
})

describe('selenium action-snapshot locator dialect', () => {
  it('injects the XPath text form, which By.xpath resolves', async () => {
    // `a*=Logout` is WebdriverIO-only syntax; a Selenium user pastes the
    // captured locator into `By.xpath`, so the capture must emit XPath.
    const driver = fakeDriver()
    const { ctx, snapshotCaptures } = makeCtx(driver)

    await handleOnCommand(ctx, cmd({ command: 'click', timestamp: 1 }))
    await Promise.all(snapshotCaptures)

    const scripts = vi
      .mocked(driver.executeScript)
      .mock.calls.map(([src]) => String(src))
    expect(scripts).not.toHaveLength(0)
    for (const src of scripts) {
      expect(src).not.toContain("tag + '*=' + text")
    }
  })
})

/**
 * The per-action snapshot is the densest page-script path there is: two
 * injected scripts plus url and title, on every action. On a session with no
 * document all four can only fail, and the screenshot is the one probe a
 * native app still serves.
 *
 * Stubs the patcher's `originals` bag, because that is the path the adapter
 * takes whenever anything has been patched — a plain fake driver's own methods
 * are only reached when the bag is empty.
 */
describe('the per-action snapshot on a native session', () => {
  const probes = () => {
    const originals = getDriverOriginals()
    const before = { ...originals }
    const calls = {
      executeScript: vi.fn().mockResolvedValue([]),
      takeScreenshot: vi.fn().mockResolvedValue('AA'),
      getCurrentUrl: vi.fn().mockResolvedValue('http://x/'),
      getTitle: vi.fn().mockResolvedValue('X')
    }
    Object.assign(originals, calls)
    return {
      calls,
      restore: () => {
        for (const key of Object.keys(calls)) {
          delete (originals as Record<string, unknown>)[key]
        }
        Object.assign(originals, before)
      }
    }
  }

  it('takes the screenshot and makes no page read', async () => {
    const { calls, restore } = probes()
    try {
      const snap = await captureActionSnapshot(fakeDriver(), 'click', 1, true)

      expect(calls.takeScreenshot).toHaveBeenCalled()
      expect(calls.executeScript).not.toHaveBeenCalled()
      expect(calls.getCurrentUrl).not.toHaveBeenCalled()
      expect(calls.getTitle).not.toHaveBeenCalled()
      expect(snap?.screenshot).toBe('AA')
    } finally {
      restore()
    }
  })

  it('reads the page for a session that has one', async () => {
    const { calls, restore } = probes()
    try {
      await captureActionSnapshot(fakeDriver(), 'click', 1, false)

      expect(calls.executeScript).toHaveBeenCalled()
      expect(calls.getCurrentUrl).toHaveBeenCalled()
    } finally {
      restore()
    }
  })
})
