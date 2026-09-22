import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as DevtoolsCore from '@wdio/devtools-core'
import { captureActionSnapshot } from '@wdio/devtools-core'
import DevToolsHookService from '../src/index.js'

// One user-spec frame, so `beforeCommand` reads every command as top-level.
vi.mock('stack-trace', () => ({
  parse: () => [
    {
      getFileName: () => '/test/specs/fake.spec.ts',
      getLineNumber: () => 1,
      getColumnNumber: () => 1
    }
  ]
}))

/**
 * The command has to be in the log by the time `afterCommand` returns:
 * `#lastActionTimestamp()` reads it to stamp the NEXT action's capture, and that
 * stamp is what makes an action's result the following action's "before".
 */
const commandsLog: { command: string; timestamp: number }[] = []
let clock = 0
const capturer = {
  afterCommand: vi.fn(async (_browser: unknown, command: string) => {
    commandsLog.push({ command, timestamp: ++clock })
  }),
  sendUpstream: vi.fn(),
  mergeMetadata: vi.fn(),
  captureTrace: vi.fn().mockResolvedValue(undefined),
  noteResolvedSelector: vi.fn(),
  resetLastSelector: vi.fn(),
  resetRetryTracker: vi.fn(),
  captureSource: vi.fn(),
  captureAssertCommand: vi.fn(),
  cleanup: vi.fn(),
  commandsLog,
  sources: new Map(),
  mutations: [],
  traceLogs: [],
  consoleLogs: [],
  networkRequests: [],
  isReportingUpstream: false,
  metadata: {},
  setBrowser: vi.fn(),
  /** Set by a test to stand in for the drain having brought a document the
   *  session had not anchored before. */
  replacedDocumentInLastDrain: false
}

vi.mock('../src/session.js', () => ({
  SessionCapturer: vi.fn(function () {
    return capturer
  })
}))

vi.mock('../src/screencast.js', () => ({
  ScreencastRecorder: vi.fn(function () {
    return {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      setStartMarker: vi.fn(),
      frames: []
    }
  })
}))

vi.mock('@wdio/devtools-core', async (importOriginal) => {
  const actual = await importOriginal<typeof DevtoolsCore>()
  return {
    ...actual,
    captureActionSnapshot: vi.fn(actual.captureActionSnapshot),
    encodeToVideo: vi.fn().mockResolvedValue(undefined)
  }
})

vi.mock('node:fs/promises', () => ({
  default: { writeFile: vi.fn().mockResolvedValue(undefined) }
}))

/** A native Appium session: no `browserName` anywhere in the capabilities, so
 *  `isNativeAppSession` is true and the capture takes the screenshot +
 *  page-source path — the one an Appium run pays for. */
const nativeBrowser = () => {
  const capabilities = { platformName: 'Android', deviceName: 'emulator-5554' }
  return {
    isBidi: false,
    isMobile: true,
    isAndroid: true,
    sessionId: 'native-session',
    capabilities,
    options: { capabilities },
    addCommand: vi.fn(),
    on: vi.fn(),
    emit: vi.fn(),
    pause: vi.fn(async () => undefined),
    execute: vi.fn(async () => []),
    takeScreenshot: vi.fn(async () => 'SHOT'),
    getPageSource: vi.fn(
      async () => '<hierarchy><node text="Hi"/></hierarchy>'
    ),
    getWindowSize: vi.fn(async () => ({ width: 1080, height: 2424 }))
  } as unknown as WebdriverIO.Browser
}

/** A plain web session: a browser in the capabilities, so `isNativeAppSession`
 *  is false and the capture takes the page-script path. */
const webBrowser = () => {
  const capabilities = { browserName: 'chrome', platformName: 'linux' }
  return {
    isBidi: true,
    isMobile: false,
    sessionId: 'web-session',
    capabilities,
    options: { capabilities },
    addCommand: vi.fn(),
    on: vi.fn(),
    emit: vi.fn(),
    pause: vi.fn(async () => undefined),
    // Invokes the predicate, so the probe it runs is observable — WDIO's real
    // `waitUntil` polls it.
    waitUntil: vi.fn(async (predicate: () => Promise<boolean>) => {
      await predicate()
    }),
    execute: vi.fn(async () => []),
    takeScreenshot: vi.fn(async () => 'SHOT'),
    getUrl: vi.fn(async () => 'http://example.com/'),
    getTitle: vi.fn(async () => 'Example')
  } as unknown as WebdriverIO.Browser
}

/** The service's own wrapper funnels into core's single-object signature. */
const stampedAt = (call: number): number | undefined =>
  vi.mocked(captureActionSnapshot).mock.calls[call]?.[0]?.timestamp
const namedAt = (call: number): string | undefined =>
  vi.mocked(captureActionSnapshot).mock.calls[call]?.[0]?.command

describe('trace mode: one capture per action, taken before it', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    commandsLog.length = 0
    clock = 0
    capturer.replacedDocumentInLastDrain = false
  })

  it('captures in beforeCommand and not again after the command', async () => {
    const browser = nativeBrowser()
    const service = new DevToolsHookService({ mode: 'trace' })
    await service.before({} as never, [], browser)

    vi.mocked(browser.takeScreenshot).mockClear()
    vi.mocked(browser.getPageSource!).mockClear()

    await service.beforeCommand('click' as never, [])
    expect(browser.takeScreenshot).toHaveBeenCalledTimes(1)

    await service.afterCommand('click' as never, [], undefined)
    // The state this action produced belongs to the NEXT action's capture, taken
    // once the app has settled. Capturing here instead is what makes a trace
    // blurry: the screen is still moving when the command returns.
    expect(browser.takeScreenshot).toHaveBeenCalledTimes(1)
  })

  it('costs one capture per action across a sequence', async () => {
    const browser = nativeBrowser()
    const service = new DevToolsHookService({ mode: 'trace' })
    await service.before({} as never, [], browser)

    vi.mocked(browser.takeScreenshot).mockClear()
    vi.mocked(browser.getPageSource!).mockClear()
    vi.mocked(captureActionSnapshot).mockClear()

    for (const command of ['click', 'setValue', 'click']) {
      await service.beforeCommand(command as never, [])
      await service.afterCommand(command as never, [], undefined)
    }

    expect(vi.mocked(captureActionSnapshot)).toHaveBeenCalledTimes(3)
    expect(browser.takeScreenshot).toHaveBeenCalledTimes(3)
    expect(browser.getPageSource).toHaveBeenCalledTimes(3)
  })

  it('stamps each capture at the previous action end', async () => {
    const browser = nativeBrowser()
    const service = new DevToolsHookService({ mode: 'trace' })
    await service.before({} as never, [], browser)
    vi.mocked(captureActionSnapshot).mockClear()

    await service.beforeCommand('click' as never, [])
    await service.afterCommand('click' as never, [], undefined)
    await service.beforeCommand('setValue' as never, [])
    await service.afterCommand('setValue' as never, [], undefined)

    // The first action runs against a state nothing has recorded yet, so it
    // takes the capture now (it becomes the trace's initial frame). The second
    // takes the state the first produced — the first action's result IS the
    // second action's before, which is the whole design.
    expect(stampedAt(0)).toBeGreaterThan(0)
    expect(stampedAt(1)).toBe(commandsLog[0]!.timestamp)
  })

  it('captures the final state when the session ends', async () => {
    const browser = nativeBrowser()
    const service = new DevToolsHookService({ mode: 'trace' })
    await service.before({} as never, [], browser)

    vi.mocked(captureActionSnapshot).mockClear()
    await service.beforeCommand('click' as never, [])
    await service.afterCommand('click' as never, [], undefined)
    await service.after()

    // A standalone run has no per-test hook, so the last action's result would
    // never be taken: the next action's pre-capture is what supplies it
    // everywhere else.
    expect(stampedAt(1)).toBe(commandsLog[0]!.timestamp)
    expect(stampedAt(0)).toBeGreaterThan(0)

    // A framework run reaches this finalize twice — once per test and once from
    // `after()`. The slot is recorded by then, so the second pass must not pay
    // another screenshot and page-source round trip for it.
    await service.after()
    expect(vi.mocked(captureActionSnapshot)).toHaveBeenCalledTimes(2)
  })

  it('captures the last action when the previous one ended in the same millisecond', async () => {
    const browser = nativeBrowser()
    const service = new DevToolsHookService({ mode: 'trace' })
    await service.before({} as never, [], browser)

    // Two action commands completing at one logged timestamp: the last one's
    // pre-capture is stamped at the previous action's end and carries the
    // upcoming command's own name, so it fills the exact command+timestamp
    // slot the finalize is about to capture — reading the answer off the
    // recorded snapshots (by timestamp or command) mistakes it for the
    // finalize's own and the last action's result is never taken.
    const sameMs = 42
    const logAtSameMs = () =>
      vi
        .mocked(capturer.afterCommand)
        .mockImplementationOnce(async (_browser: unknown, command: string) => {
          commandsLog.push({ command, timestamp: sameMs })
        })
    logAtSameMs()
    logAtSameMs()
    for (const command of ['click', 'setValue']) {
      await service.beforeCommand(command as never, [])
      await service.afterCommand(command as never, [], undefined)
    }

    vi.mocked(captureActionSnapshot).mockClear()
    await service.after()
    expect(vi.mocked(captureActionSnapshot)).toHaveBeenCalledTimes(1)
    expect(namedAt(0)).toBe('setValue')
    expect(stampedAt(0)).toBe(sameMs)

    // `after()` re-runs the finalize for the standalone path; the slot the
    // first pass recorded keeps the second from paying for it again.
    await service.after()
    expect(vi.mocked(captureActionSnapshot)).toHaveBeenCalledTimes(1)
  })

  it('captures the no-action frame once per session', async () => {
    const browser = nativeBrowser()
    const service = new DevToolsHookService({ mode: 'trace' })
    await service.before({} as never, [], browser)

    vi.mocked(captureActionSnapshot).mockClear()
    await service.after()
    await service.after()

    // A session that ran no action has no timestamp to key on, so the marker
    // carries the "already captured" answer — otherwise each finalize takes the
    // same frame again under a fresh `Date.now()`.
    expect(vi.mocked(captureActionSnapshot)).toHaveBeenCalledTimes(1)
    expect(namedAt(0)).toBe('__final__')
  })

  it('settles the driver once, only for the final capture', async () => {
    const browser = nativeBrowser()
    const service = new DevToolsHookService({ mode: 'trace' })
    await service.before({} as never, [], browser)

    vi.mocked(browser.pause).mockClear()
    for (const command of ['click', 'setValue']) {
      await service.beforeCommand(command as never, [])
      await service.afterCommand(command as never, [], undefined)
    }
    // Per-action captures take the page at a moment the driver is already idle —
    // paying a settle for each of them is the cost this design removed.
    expect(browser.pause).not.toHaveBeenCalled()

    await service.after()
    // The last action has no successor, so its capture is the one that needs it.
    expect(browser.pause).toHaveBeenCalledTimes(1)
  })

  it('takes the final capture at the last action, past an internal command', async () => {
    const browser = nativeBrowser()
    const service = new DevToolsHookService({ mode: 'trace' })
    await service.before({} as never, [], browser)
    await service.beforeCommand('click' as never, [])
    await service.afterCommand('click' as never, [], undefined)
    // A read the capture gates exclude, and the last thing the test did. It is
    // mapped, so counting it would stamp the final capture at a timestamp no
    // visible row owns — and skipping it entirely would lose the click's result.
    await service.beforeCommand('getTitle' as never, [])
    await service.afterCommand('getTitle' as never, [], 'title')

    vi.mocked(captureActionSnapshot).mockClear()
    await service.after()

    expect(namedAt(0)).toBe('click')
    expect(stampedAt(0)).toBe(commandsLog[0]!.timestamp)
  })

  it('does not merge the next test first capture into the previous test slot', async () => {
    const browser = nativeBrowser()
    const service = new DevToolsHookService({ mode: 'trace' })
    await service.before({} as never, [], browser)
    const first = { file: '/spec/a.ts', title: 'first' }
    service.beforeTest(first as never)
    await service.beforeCommand('click' as never, [])
    await service.afterCommand('click' as never, [], undefined)
    await service.afterTest(first as never, {} as never, {} as never)

    const lastOfFirst = commandsLog[0]!.timestamp
    vi.mocked(captureActionSnapshot).mockClear()

    await new Promise((resolve) => setTimeout(resolve, 5))
    const secondTestStart = Date.now()
    service.beforeTest({ file: '/spec/a.ts', title: 'second' } as never)
    await service.beforeCommand('click' as never, [])

    // The previous test's last action already has its own capture, taken by that
    // test's finalize. Stamping this test's initial frame at the same timestamp
    // lets the richer-screenshot merge replace it — under a reloadSession the
    // row then shows the post-reload page instead of that test's last state.
    expect(stampedAt(0)).not.toBe(lastOfFirst)
    expect(stampedAt(0)).toBeGreaterThanOrEqual(secondTestStart)
  })

  it('still lets the paint land when the wait for a load times out', async () => {
    const browser = webBrowser()
    capturer.replacedDocumentInLastDrain = true
    vi.mocked(browser.waitUntil).mockRejectedValueOnce(new Error('timeout'))
    const service = new DevToolsHookService({ mode: 'trace' })
    await service.before({} as never, [], browser)
    await service.beforeCommand('click' as never, [])
    await service.afterCommand('click' as never, [], undefined)

    vi.mocked(browser.pause).mockClear()
    await service.after()

    // A page slow enough to blow the timeout is still mid-paint, so it is the
    // one that most needs the pause — the wait's rejection must not skip it.
    expect(browser.pause).toHaveBeenCalledTimes(1)
  })

  it('names the final capture after the action it captures', async () => {
    const browser = nativeBrowser()
    const service = new DevToolsHookService({ mode: 'trace' })
    await service.before({} as never, [], browser)
    await service.beforeCommand('click' as never, [])
    await service.afterCommand('click' as never, [], undefined)

    vi.mocked(captureActionSnapshot).mockClear()
    await service.after()

    // Not `__final__`: this capture IS the last action's result, and the
    // per-test screenshot reader (`lastRenderedScreenshot`) skips that marker,
    // so naming it `__final__` made the Allure screenshot show the page from
    // BEFORE the last action — the one a failure is inspected for.
    expect(namedAt(0)).toBe('click')
  })

  it('never settles the driver', async () => {
    const browser = nativeBrowser()
    const service = new DevToolsHookService({ mode: 'trace' })
    await service.before({} as never, [], browser)

    vi.mocked(browser.pause).mockClear()
    vi.mocked(browser.execute).mockClear()
    for (const command of ['click', 'setValue', 'getText']) {
      await service.beforeCommand(command as never, [])
      await service.afterCommand(command as never, [], undefined)
    }

    // No pause, no readyState poll, no document tag: the capture happens at a
    // moment the driver is already idle, so there is nothing to wait for.
    expect(browser.pause).not.toHaveBeenCalled()
    expect(browser.execute).not.toHaveBeenCalled()
  })

  it('waits for a document the last action navigated to, and only that', async () => {
    const browser = webBrowser()
    const service = new DevToolsHookService({ mode: 'trace' })
    await service.before({} as never, [], browser)
    await service.beforeCommand('click' as never, [])
    await service.afterCommand('click' as never, [], undefined)

    vi.mocked(browser.pause).mockClear()
    vi.mocked(browser.waitUntil).mockClear()
    vi.mocked(browser.execute).mockClear()
    await service.after()

    // No new document in the final drain: the app has been at rest since the
    // last action, so its paint already landed. Waiting here is the cost this
    // design removes from every test.
    expect(browser.waitUntil).not.toHaveBeenCalled()
    expect(browser.pause).not.toHaveBeenCalled()

    capturer.replacedDocumentInLastDrain = true
    await service.beforeCommand('click' as never, [])
    await service.afterCommand('click' as never, [], undefined)
    vi.mocked(browser.pause).mockClear()
    vi.mocked(browser.waitUntil).mockClear()
    vi.mocked(browser.execute).mockClear()
    await service.after()

    // A document the session had not seen IS loading, so readyState is the
    // right question — it describes the incoming document, not the outgoing one
    // that still reports 'complete'.
    expect(browser.waitUntil).toHaveBeenCalledTimes(1)
    const bodies = vi
      .mocked(browser.execute)
      .mock.calls.map(([fn]) => String(fn))
    expect(bodies.some((body) => body.includes('readyState'))).toBe(true)
    // The old poll also required a non-empty body, which made a legitimately
    // blank destination a guaranteed timeout rather than a settled page.
    expect(bodies.some((body) => body.includes('childElementCount'))).toBe(
      false
    )
  })
})
