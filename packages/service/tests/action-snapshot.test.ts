import { describe, it, expect, vi } from 'vitest'
import type { ActionSnapshot } from '@wdio/devtools-shared'
import {
  captureActionResult,
  pushActionSnapshotAt
} from '../src/action-snapshot.js'

const mockBrowser = () =>
  ({
    execute: vi.fn().mockResolvedValue([]),
    takeScreenshot: vi.fn().mockResolvedValue('SHOT'),
    getUrl: vi.fn().mockResolvedValue('http://example.com/'),
    getTitle: vi.fn().mockResolvedValue('Example')
  }) as unknown as WebdriverIO.Browser

describe('pushActionSnapshotAt', () => {
  it('captures a DOM snapshot and stamps it at the row timestamp', async () => {
    const snapshots: ActionSnapshot[] = []
    await pushActionSnapshotAt(
      mockBrowser(),
      'expect.toExist',
      12345,
      snapshots
    )
    expect(snapshots).toHaveLength(1)
    // Stamped at the row's own timestamp — not the capture time — so the trace
    // player's FrameSnapshotIndex.claimAfter(cmd.timestamp) matches it.
    expect(snapshots[0]!.timestamp).toBe(12345)
    expect(snapshots[0]!.command).toBe('expect.toExist')
    expect(snapshots[0]!.screenshot).toBe('SHOT')
  })
})

describe('service action-snapshot locator dialect', () => {
  it("injects WebdriverIO's own text form, which resolves in $() directly", async () => {
    // Portable XPath resolves here too, but a WDIO user copying a locator out of
    // the A11y tab expects `a*=Logout`, not something they must wrap.
    const browser = Object.assign(mockBrowser(), {
      options: { framework: 'cucumber' }
    })
    await pushActionSnapshotAt(browser, 'click', 1, [])

    const bodies = vi
      .mocked(browser.execute)
      .mock.calls.map(([fn]) => String(fn))
    expect(bodies).not.toHaveLength(0)
    for (const body of bodies) {
      expect(body).toContain("tag + '*=' + text")
    }
  })
})

/**
 * A mobile BROWSER session has a document, so it takes the web path. Gated on
 * being mobile it took the native one: the page-source reader parses Appium XML
 * and a chromedriver-backed session answers HTML, so the trace reached the
 * player with no elements, no a11y tree, no url and no title.
 */
describe('an Appium session driving a browser', () => {
  const mobileWeb = () =>
    Object.assign(mockBrowser(), {
      isMobile: false,
      isAndroid: true,
      capabilities: {
        platformName: 'Android',
        browserName: 'Chrome',
        'appium:automationName': 'Chrome'
      },
      getPageSource: vi.fn().mockResolvedValue('<html></html>')
    }) as unknown as WebdriverIO.Browser

  const nativeApp = () =>
    Object.assign(mockBrowser(), {
      isMobile: true,
      isAndroid: true,
      capabilities: {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:app': '/app.apk'
      },
      getPageSource: vi.fn().mockResolvedValue('<hierarchy/>')
    }) as unknown as WebdriverIO.Browser

  it('reads the page with script, not as page-source XML', async () => {
    const browser = mobileWeb()

    await pushActionSnapshotAt(browser, 'click', 1, [])

    expect(browser.execute).toHaveBeenCalled()
    expect(browser.getPageSource).not.toHaveBeenCalled()
  })

  it('reports its url and title, which a browser session has', async () => {
    const browser = mobileWeb()

    await pushActionSnapshotAt(browser, 'click', 1, [])

    expect(browser.getUrl).toHaveBeenCalled()
    expect(browser.getTitle).toHaveBeenCalled()
  })

  it('leaves a native app on the page-source path', async () => {
    const browser = nativeApp()

    await pushActionSnapshotAt(browser, 'click', 1, [])

    expect(browser.getPageSource).toHaveBeenCalled()
    expect(browser.execute).not.toHaveBeenCalled()
    expect(browser.getUrl).not.toHaveBeenCalled()
  })
})

/**
 * The settle waits on the `__wdioSnapMark` tag that `#markDocument` writes, and
 * both key on having a document — split across the two predicates, a session
 * tags a document nothing ever settles on, and its post-action screenshot comes
 * from the page it navigated away from.
 */
describe('the post-action settle', () => {
  const settleable = (flags: Record<string, unknown>) =>
    Object.assign(mockBrowser(), flags, {
      execute: vi.fn().mockResolvedValue(true),
      waitUntil: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockResolvedValue(undefined)
    }) as unknown as WebdriverIO.Browser

  it('runs for an Appium session driving a browser', async () => {
    const browser = settleable({
      isMobile: false,
      isAndroid: true,
      capabilities: { platformName: 'Android', browserName: 'Chrome' }
    })

    await captureActionResult(browser, 'click', [], () => 1)

    // The mark probe is the settle's first act, so its body identifies it.
    const bodies = vi
      .mocked(browser.execute)
      .mock.calls.map(([fn]) => String(fn))
    expect(bodies.some((body) => body.includes('__wdioSnapMark'))).toBe(true)
  })

  it('does not for a native app, which has no document to settle', async () => {
    const browser = settleable({
      isMobile: true,
      isAndroid: true,
      capabilities: {
        platformName: 'Android',
        'appium:app': '/app.apk'
      }
    })

    await captureActionResult(browser, 'click', [], () => 1)

    const bodies = vi
      .mocked(browser.execute)
      .mock.calls.map(([fn]) => String(fn))
    expect(bodies.some((body) => body.includes('__wdioSnapMark'))).toBe(false)
  })
})
