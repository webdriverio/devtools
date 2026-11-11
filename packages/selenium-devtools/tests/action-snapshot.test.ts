import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type * as DevtoolsCore from '@wdio/devtools-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
import { captureFinalFrame } from '../src/helpers/finalFrame.js'
import { handleActionsPerformed } from '../src/helpers/commandPostActions.js'
import type { SessionLifecycleCtx } from '../src/session-lifecycle.js'
import { getDriverOriginals } from '../src/driverPatcher.js'
import {
  RetryTracker,
  captureActionSnapshot as coreCapture,
  reportCaptureTiming
} from '@wdio/devtools-core'
import {
  CAPTURE_TIMING_ENV,
  type ActionSnapshot,
  type CaptureTimingRecord
} from '@wdio/devtools-shared'
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
type FakeDriver = SeleniumDriverLike &
  Required<Pick<SeleniumDriverLike, 'takeScreenshot'>>

function fakeDriver(): FakeDriver {
  return {
    executeScript: vi.fn().mockResolvedValue([]),
    takeScreenshot: vi.fn().mockResolvedValue('AA'),
    getCurrentUrl: vi.fn().mockResolvedValue('http://example.test/'),
    getTitle: vi.fn().mockResolvedValue('Example')
  } as unknown as FakeDriver
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

  it('does not capture for a read-only lookup', async () => {
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
  // The capture reads through the patcher's originals; route them to the fake
  // driver so its screenshot probe is the one that can fail.
  const patched = ['takeScreenshot'] as const
  beforeEach(() => {
    const originals = getDriverOriginals() as Record<string, unknown>
    for (const key of patched) {
      originals[key] = (d: FakeDriver) => d[key]()
    }
  })
  afterEach(() => {
    const originals = getDriverOriginals() as Record<string, unknown>
    for (const key of patched) {
      delete originals[key]
    }
  })

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

  it('captures an unmapped command that can change the page', async () => {
    const { actionSnapshots } = await run(['executeScript', 'actions'])
    expect(actionSnapshots.map((s) => s.timestamp)).toEqual([1, 2])
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

  it('retries the initial frame when the first read captures no screenshot', async () => {
    const driver = fakeDriver()
    vi.mocked(driver.takeScreenshot).mockRejectedValueOnce(new Error('gone'))
    vi.mocked(coreCapture).mockClear()
    const bag = makeCtx(driver)
    for (const [i, command] of [
      'getText',
      'isDisplayed',
      'getText'
    ].entries()) {
      await handleOnCommand(bag.ctx, cmd({ command, timestamp: i + 1 }))
      await Promise.all(bag.snapshotCaptures)
    }
    expect(vi.mocked(coreCapture)).toHaveBeenCalledTimes(2)
    expect(bag.actionSnapshots.map((s) => s.timestamp)).toEqual([1, 2])
    expect(bag.actionSnapshots.map((s) => !!s.screenshot)).toEqual([
      false,
      true
    ])
  })

  it('attempts the initial frame at most twice when every screenshot fails', async () => {
    const driver = fakeDriver()
    vi.mocked(driver.takeScreenshot).mockRejectedValue(new Error('gone'))
    vi.mocked(coreCapture).mockClear()
    const bag = makeCtx(driver)
    for (const [i, command] of [
      'getText',
      'getText',
      'getText',
      'getText'
    ].entries()) {
      await handleOnCommand(bag.ctx, cmd({ command, timestamp: i + 1 }))
      await Promise.all(bag.snapshotCaptures)
    }
    expect(vi.mocked(coreCapture)).toHaveBeenCalledTimes(2)
  })

  it('retries the initial frame when the first capture resolves null', async () => {
    vi.mocked(coreCapture).mockClear()
    vi.mocked(coreCapture).mockResolvedValueOnce(null)
    const bag = makeCtx(fakeDriver())
    for (const [i, command] of ['getText', 'getText', 'getText'].entries()) {
      await handleOnCommand(bag.ctx, cmd({ command, timestamp: i + 1 }))
      await Promise.all(bag.snapshotCaptures)
    }
    expect(vi.mocked(coreCapture)).toHaveBeenCalledTimes(2)
    expect(bag.actionSnapshots.map((s) => s.timestamp)).toEqual([2])
  })

  it('retries the initial frame when a page-changing first command loses its screenshot', async () => {
    const driver = fakeDriver()
    vi.mocked(driver.takeScreenshot).mockRejectedValueOnce(new Error('gone'))
    vi.mocked(coreCapture).mockClear()
    const bag = await run(['click', 'getText', 'getText'], makeCtx(driver))
    expect(vi.mocked(coreCapture)).toHaveBeenCalledTimes(2)
    expect(bag.actionSnapshots.map((s) => !!s.screenshot)).toEqual([
      false,
      true
    ])
  })

  it('does not re-arm the initial frame from a capture that resolves after the next test starts', async () => {
    type Snap = Awaited<ReturnType<typeof coreCapture>>
    let resolveFirst!: (snap: Snap) => void
    vi.mocked(coreCapture)
      .mockClear()
      .mockImplementationOnce(
        () =>
          new Promise<Snap>((resolve) => {
            resolveFirst = resolve
          })
      )
    const bag = makeCtx(fakeDriver())
    await handleOnCommand(bag.ctx, cmd({ command: 'getText', timestamp: 1 }))
    bag.capturer.resetTestCapture()
    resolveFirst({ timestamp: 1, command: 'getText' } as Snap)
    await Promise.all(bag.snapshotCaptures)

    expect(bag.capturer.testCapture.initialFrameRetried).toBe(false)
    expect(bag.capturer.testCapture.awaitingInitialFrame).toBe(true)
  })

  describe('end-of-test frame', () => {
    const endOfTest = (bag: ReturnType<typeof makeCtx>) =>
      captureFinalFrame(bag.ctx as unknown as SessionLifecycleCtx)

    it('replaces the last capture with the end state when reads follow it', async () => {
      const bag = await run(['click', 'getText'])
      expect(bag.actionSnapshots.map((s) => s.timestamp)).toEqual([1])

      vi.mocked(coreCapture).mockClear()
      vi.mocked(coreCapture).mockResolvedValueOnce({
        timestamp: 1,
        command: 'click',
        screenshot: 'FINAL',
        elements: [{ selector: '#final' }]
      } as unknown as ActionSnapshot)
      await endOfTest(bag)

      expect(vi.mocked(coreCapture)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(coreCapture).mock.calls[0]?.[0]).toMatchObject({
        trigger: 'final'
      })
      expect(bag.actionSnapshots).toHaveLength(1)
      expect(bag.actionSnapshots[0]!.screenshot).toBe('FINAL')
      expect(bag.actionSnapshots[0]!.elements).toEqual([{ selector: '#final' }])
    })

    it('takes no end-of-test frame when the test ends on a capturing command', async () => {
      const bag = await run(['getText', 'click'])
      vi.mocked(coreCapture).mockClear()
      await endOfTest(bag)

      expect(vi.mocked(coreCapture)).not.toHaveBeenCalled()
      expect(bag.actionSnapshots.map((s) => s.timestamp)).toEqual([1, 2])
    })

    it('takes no end-of-test frame for a test with no rows', async () => {
      const bag = makeCtx(fakeDriver())
      vi.mocked(coreCapture).mockClear()
      await endOfTest(bag)

      expect(vi.mocked(coreCapture)).not.toHaveBeenCalled()
    })

    it('keeps the earlier capture when the end state saw no page', async () => {
      vi.mocked(coreCapture).mockResolvedValueOnce({
        timestamp: 1,
        command: 'click',
        screenshot: 'GOOD',
        elements: [{ selector: '#good' }]
      } as unknown as ActionSnapshot)
      const bag = await run(['click', 'getText'])
      const before = { ...bag.actionSnapshots[0]! }
      expect(before.screenshot).toBe('GOOD')

      vi.mocked(coreCapture).mockClear()
      vi.mocked(coreCapture).mockResolvedValueOnce({
        timestamp: 1,
        command: 'click',
        snapshotText: '[Page]',
        elements: []
      } as unknown as ActionSnapshot)
      await endOfTest(bag)

      expect(vi.mocked(coreCapture)).toHaveBeenCalledTimes(1)
      expect(bag.actionSnapshots).toEqual([before])
    })
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
 * A native app serves no page script, url or title, so the screenshot and the
 * page-source XML are the only probes; core builds the element list and the
 * accessibility tree from the XML.
 *
 * Stubs the patcher's `originals` bag, because that is the path the adapter
 * takes whenever anything has been patched; the source read has to go through
 * it, or it would be recorded as a `getPageSource` row of the user's own.
 */
describe('the per-action snapshot on a native session', () => {
  const ANDROID_SOURCE = `<hierarchy>
  <android.widget.FrameLayout bounds="[0,0][1080,2424]">
    <android.widget.Button clickable="true" content-desc="Start" text="Start" bounds="[100,200][400,300]"/>
  </android.widget.FrameLayout>
</hierarchy>`
  const IOS_SOURCE = `<XCUIElementTypeApplication name="Settings" label="Settings" x="0" y="0" width="402" height="874">
  <XCUIElementTypeButton name="General" label="General" enabled="true" visible="true" accessible="true" x="0" y="100" width="402" height="44"/>
</XCUIElementTypeApplication>`

  const probes = (source = ANDROID_SOURCE) => {
    const originals = getDriverOriginals()
    const before = { ...originals }
    const calls = {
      executeScript: vi.fn().mockResolvedValue([]),
      takeScreenshot: vi.fn().mockResolvedValue('AA'),
      getCurrentUrl: vi.fn().mockResolvedValue('http://x/'),
      getTitle: vi.fn().mockResolvedValue('X'),
      getPageSource: vi.fn().mockResolvedValue(source)
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

  it('reads the page source and the screenshot, and makes no page read', async () => {
    const { calls, restore } = probes()
    try {
      const driver = fakeDriver()
      const snap = await captureActionSnapshot(driver, 'click', 1, {
        platform: 'android'
      })

      expect(calls.takeScreenshot).toHaveBeenCalled()
      expect(calls.getPageSource).toHaveBeenCalledWith(driver)
      expect(calls.executeScript).not.toHaveBeenCalled()
      expect(calls.getCurrentUrl).not.toHaveBeenCalled()
      expect(calls.getTitle).not.toHaveBeenCalled()
      expect(snap?.screenshot).toBe('AA')
    } finally {
      restore()
    }
  })

  it('builds the element list and accessibility tree from an Android page source', async () => {
    const { restore } = probes()
    try {
      const snap = await captureActionSnapshot(fakeDriver(), 'click', 1, {
        platform: 'android'
      })

      expect(snap?.snapshotText).toContain('[android]')
      expect(snap?.snapshotText).toContain('button "Start"')
      expect(snap?.elements?.length).toBeGreaterThan(0)
    } finally {
      restore()
    }
  })

  it('reads an iOS page source as iOS', async () => {
    const { restore } = probes(IOS_SOURCE)
    try {
      const snap = await captureActionSnapshot(fakeDriver(), 'click', 1, {
        platform: 'ios'
      })

      expect(snap?.snapshotText).toContain('[ios]')
      expect(snap?.snapshotText).toContain('General')
      expect(snap?.elements?.length).toBeGreaterThan(0)
    } finally {
      restore()
    }
  })

  it('passes the session platform from the capturer to the capture', async () => {
    const { calls, restore } = probes(IOS_SOURCE)
    try {
      const bag = makeCtx(fakeDriver())
      bag.capturer.metadata = {
        capabilities: {
          platformName: 'iOS',
          'appium:automationName': 'XCUITest',
          'appium:app': '/Settings.app'
        }
      } as never
      await handleOnCommand(bag.ctx, cmd({ command: 'click', timestamp: 7 }))
      await Promise.all(bag.snapshotCaptures)

      expect(calls.executeScript).not.toHaveBeenCalled()
      expect(bag.actionSnapshots[0]?.snapshotText).toContain('[ios]')
      expect(bag.actionSnapshots[0]?.elements?.length).toBeGreaterThan(0)
    } finally {
      restore()
    }
  })

  it('reports the capture as native, with the page-source probe timed', async () => {
    const { restore } = probes()
    vi.stubEnv(CAPTURE_TIMING_ENV, '1')
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-native-timing-'))
    try {
      await captureActionSnapshot(fakeDriver(), 'click', 1, {
        platform: 'android'
      })
      const file = await reportCaptureTiming(outDir, () => undefined)
      const [record] = fs
        .readFileSync(file!, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as CaptureTimingRecord)

      expect(record?.native).toBe(true)
      expect(record?.probes.map((p) => p.probe)).toEqual([
        'pageSource',
        'screenshot',
        'process'
      ])
    } finally {
      vi.unstubAllEnvs()
      fs.rmSync(outDir, { recursive: true, force: true })
      restore()
    }
  })

  it('reads the page for a session that has one', async () => {
    const { calls, restore } = probes()
    try {
      await captureActionSnapshot(fakeDriver(), 'click', 1)

      expect(calls.executeScript).toHaveBeenCalled()
      expect(calls.getCurrentUrl).toHaveBeenCalled()
      expect(calls.getPageSource).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })
})

describe('driver-level action sequences', () => {
  it('captures the page a perform left without adding a timeline row', async () => {
    const bag = makeCtx(fakeDriver())
    vi.mocked(coreCapture).mockClear()

    handleActionsPerformed(bag.ctx)
    await Promise.all(bag.snapshotCaptures)

    expect(vi.mocked(coreCapture)).toHaveBeenCalledTimes(1)
    expect(bag.capturer.commandsLog).toHaveLength(0)
    expect(bag.actionSnapshots).toHaveLength(1)
    expect(bag.actionSnapshots[0]!.command).toBe('performActions')
  })
})
