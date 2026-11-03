import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { captureActionSnapshot } from '../src/action-snapshot.js'
import { SessionCapturer } from '../src/session.js'
import { webdriverExecute } from '../src/helpers/webdriverHttp.js'
import type * as WebdriverHttp from '../src/helpers/webdriverHttp.js'
import type { ActionSnapshot } from '@wdio/devtools-shared'
import type { NightwatchBrowser } from '../src/types.js'

vi.mock('../src/action-snapshot.js', () => ({
  captureActionSnapshot: vi.fn()
}))

vi.mock('../src/helpers/webdriverHttp.js', async (importOriginal) => ({
  ...(await importOriginal<typeof WebdriverHttp>()),
  webdriverExecute: vi.fn()
}))

const browser = {
  sessionId: 'sess-recapture',
  capabilities: {},
  options: { webdriver: { host: 'localhost', port: 4444 } }
} as unknown as NightwatchBrowser

/** `performance.timeOrigin` reads, one per poll; the last origin repeats. */
function originsRead(origins: number[]) {
  let read = 0
  vi.mocked(webdriverExecute).mockImplementation(async () => {
    return origins[Math.min(read++, origins.length - 1)] as never
  })
}

function shot(fields: Partial<ActionSnapshot>): ActionSnapshot {
  return { command: 'click', timestamp: 100, ...fields } as ActionSnapshot
}

/** A click on /login whose capture read the page before the submit committed. */
async function clickThenAnchor(cap: SessionCapturer) {
  await cap.captureCommand('click', ['#submit'], null, undefined, {
    timestamp: 100
  })
  await cap.anchorAfterNavigation(browser, 100)
  await Promise.all(cap.snapshotCaptures)
}

describe('Nightwatch post-navigation re-capture', () => {
  let cap: SessionCapturer

  beforeEach(() => {
    vi.mocked(captureActionSnapshot).mockReset()
    vi.spyOn(SessionCapturer.prototype, 'captureTrace').mockResolvedValue()
    cap = new SessionCapturer({}, browser)
    cap.traceMode = 'trace'
  })

  afterEach(() => {
    cap.cleanup()
    vi.restoreAllMocks()
  })

  it('supersedes the click capture with one taken once navigation is seen', async () => {
    originsRead([1000, 2000])
    vi.mocked(captureActionSnapshot)
      .mockResolvedValueOnce(
        shot({ url: 'http://app.test/login', screenshot: 'OLD' })
      )
      .mockResolvedValueOnce(
        shot({ url: 'http://app.test/secure', screenshot: 'NEW' })
      )

    await cap.anchorAfterNavigation(browser)
    await clickThenAnchor(cap)

    expect(captureActionSnapshot).toHaveBeenCalledTimes(2)
    expect(vi.mocked(captureActionSnapshot).mock.calls[1]?.[2]).toBe(100)
    expect(cap.actionSnapshots).toHaveLength(1)
    expect(cap.actionSnapshots[0]).toMatchObject({
      timestamp: 100,
      url: 'http://app.test/secure',
      screenshot: 'NEW'
    })
  })

  it('takes no re-capture when the queued capture already read the destination', async () => {
    originsRead([1000, 2000])
    vi.mocked(captureActionSnapshot).mockResolvedValueOnce(
      shot({
        command: 'click',
        timestamp: 2500,
        url: 'http://app.test/secure',
        screenshot: 'NEW'
      })
    )

    await cap.anchorAfterNavigation(browser)
    await cap.captureCommand('click', ['#next'], null, undefined, {
      timestamp: 2500
    })
    await cap.anchorAfterNavigation(browser, 2500)
    await Promise.all(cap.snapshotCaptures)

    expect(captureActionSnapshot).toHaveBeenCalledTimes(1)
    expect(cap.actionSnapshots[0]).toMatchObject({
      url: 'http://app.test/secure',
      screenshot: 'NEW'
    })
  })

  it('takes no extra capture when the document is not replaced', async () => {
    originsRead([1000])
    vi.mocked(captureActionSnapshot).mockResolvedValueOnce(
      shot({ url: 'http://app.test/login', screenshot: 'OLD' })
    )

    await cap.anchorAfterNavigation(browser)
    await clickThenAnchor(cap)

    expect(captureActionSnapshot).toHaveBeenCalledTimes(1)
    expect(cap.actionSnapshots[0]).toMatchObject({
      url: 'http://app.test/login',
      screenshot: 'OLD'
    })
  })

  it('leaves the record when the re-capture holds no page state', async () => {
    originsRead([1000, 2000])
    vi.mocked(captureActionSnapshot)
      .mockResolvedValueOnce(
        shot({
          url: 'http://app.test/login',
          screenshot: 'OLD',
          snapshotText: 'old'
        })
      )
      .mockResolvedValueOnce(shot({ snapshotText: 'blank' }))

    await cap.anchorAfterNavigation(browser)
    await clickThenAnchor(cap)

    expect(captureActionSnapshot).toHaveBeenCalledTimes(2)
    expect(cap.actionSnapshots[0]).toMatchObject({
      url: 'http://app.test/login',
      screenshot: 'OLD',
      snapshotText: 'old'
    })
  })

  it('takes no re-capture for a command that queued none', async () => {
    originsRead([1000, 2000])
    vi.mocked(captureActionSnapshot).mockResolvedValue(shot({}))

    await cap.anchorAfterNavigation(browser)
    await cap.captureCommand('getText', ['#flash'], 'x', undefined, {
      timestamp: 100
    })
    const queued = vi.mocked(captureActionSnapshot).mock.calls.length
    await cap.anchorAfterNavigation(browser, 100)

    expect(captureActionSnapshot).toHaveBeenCalledTimes(queued)
  })

  it('attributes a navigation seen during a fill poll to the click that caused it', async () => {
    let pageUrl = 'http://app.test/login'
    let reads = 0
    vi.mocked(captureActionSnapshot).mockImplementation(
      async (_browser, command, timestamp) =>
        shot({ command, timestamp, url: pageUrl, screenshot: pageUrl })
    )
    vi.mocked(webdriverExecute).mockImplementation(async () => {
      reads++
      if (reads === 2) {
        void cap.captureCommand('click', ['#submit'], null, undefined, {
          timestamp: 200
        })
        return 1000 as never
      }
      if (reads === 3) {
        pageUrl = 'http://app.test/secure'
        return 2000 as never
      }
      return 1000 as never
    })

    await cap.anchorAfterNavigation(browser)
    await cap.captureCommand('setValue', ['#username'], 'tomsmith', undefined, {
      timestamp: 100
    })
    await cap.anchorAfterNavigation(browser, 100)
    await Promise.all(cap.snapshotCaptures)

    expect(
      vi
        .mocked(captureActionSnapshot)
        .mock.calls.map((call) => [call[1], call[2]])
    ).toEqual([
      ['setValue', 100],
      ['click', 200],
      ['click', 200]
    ])
    expect(cap.actionSnapshots.find((s) => s.timestamp === 100)).toMatchObject({
      url: 'http://app.test/login',
      screenshot: 'http://app.test/login'
    })
    expect(cap.actionSnapshots.find((s) => s.timestamp === 200)).toMatchObject({
      url: 'http://app.test/secure',
      screenshot: 'http://app.test/secure'
    })
  })

  it('discards a re-capture superseded by a page capture queued while it was in flight', async () => {
    originsRead([1000, 2000])
    let finishRecapture!: (snap: ActionSnapshot) => void
    vi.mocked(captureActionSnapshot)
      .mockResolvedValueOnce(
        shot({ url: 'http://app.test/login', screenshot: 'OLD' })
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => (finishRecapture = resolve))
      )
      .mockResolvedValueOnce(
        shot({
          command: 'click',
          timestamp: 150,
          url: 'http://app.test/secure',
          screenshot: 'NEXT'
        })
      )

    await cap.anchorAfterNavigation(browser)
    await cap.captureCommand('click', ['#submit'], null, undefined, {
      timestamp: 100
    })
    const anchored = cap.anchorAfterNavigation(browser, 100)
    await vi.waitFor(() =>
      expect(captureActionSnapshot).toHaveBeenCalledTimes(2)
    )
    await cap.captureCommand('click', ['#next'], null, undefined, {
      timestamp: 150
    })
    finishRecapture(
      shot({ url: 'http://app.test/secure', screenshot: 'STALE' })
    )
    await anchored
    await Promise.all(cap.snapshotCaptures)

    expect(cap.actionSnapshots.find((s) => s.timestamp === 100)).toMatchObject({
      url: 'http://app.test/login',
      screenshot: 'OLD'
    })
  })

  it('re-captures once when overlapping polls detect the same replacement', async () => {
    let pageUrl = 'http://app.test/login'
    vi.mocked(captureActionSnapshot).mockImplementation(
      async (_browser, command, timestamp) =>
        shot({ command, timestamp, url: pageUrl, screenshot: pageUrl })
    )
    vi.mocked(webdriverExecute).mockImplementation(
      async () => (pageUrl === 'http://app.test/login' ? 1000 : 2000) as never
    )

    await cap.anchorAfterNavigation(browser)
    await cap.captureCommand('click', ['#submit'], null, undefined, {
      timestamp: 200
    })
    pageUrl = 'http://app.test/secure'
    await Promise.all([
      cap.anchorAfterNavigation(browser, 150),
      cap.anchorAfterNavigation(browser, 180)
    ])
    await Promise.all(cap.snapshotCaptures)

    expect(captureActionSnapshot).toHaveBeenCalledTimes(2)
    expect(cap.actionSnapshots).toHaveLength(1)
    expect(cap.actionSnapshots[0]).toMatchObject({
      timestamp: 200,
      url: 'http://app.test/secure'
    })
  })
})
