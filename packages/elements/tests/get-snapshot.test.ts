import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@wdio/snapshot', async (importActual) => {
  const actual = await importActual<typeof snap>()
  return {
    ...actual,
    collectWeb: vi.fn(),
    attachSelectors: vi.fn(),
    formatSnapshot: vi.fn(() => 'TEXT'),
    inViewport: vi.fn(),
    parseNativeSource: vi.fn(actual.parseNativeSource)
  }
})

import * as snap from '@wdio/snapshot'
import { getSnapshot } from '../src/get-snapshot.js'

const TREE = { role: 'document', children: [] } as unknown as snap.SnapshotNode
const REFS = [{ id: 'e1', candidates: [] }] as unknown as snap.SnapshotRef[]

function browser(overrides: Record<string, unknown>) {
  return {
    capabilities: { browserName: 'chrome' },
    ...overrides
  } as unknown as WebdriverIO.Browser
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(snap.collectWeb).mockResolvedValue({
    tree: TREE,
    refs: REFS,
    counter: 1
  } as never)
})

describe('getSnapshot (web)', () => {
  it('collects the full page and renders with selectors', async () => {
    const b = browser({ isBidi: true })
    const result = await getSnapshot(b)

    expect(snap.collectWeb).toHaveBeenCalledWith(
      b,
      {
        counter: 0,
        all: false,
        boxes: false,
        viewport: false,
        assignRefs: 'ephemeral'
      },
      { transport: 'classic-first' }
    )
    expect(snap.attachSelectors).toHaveBeenCalledWith(TREE, REFS)
    expect(snap.formatSnapshot).toHaveBeenCalledWith(TREE, {
      selectors: true,
      frameHint: expect.any(Function)
    })
    expect(
      vi.mocked(snap.formatSnapshot).mock.calls[0][1]?.frameHint?.('e3')
    ).toBe('wdio session frame e3')
    expect(result).toEqual({ text: 'TEXT', refs: REFS })
  })

  it('passes viewport through, and uses the bidi transport on a classic session', async () => {
    const b = browser({ isBidi: false })
    await getSnapshot(b, { viewport: true })

    expect(snap.collectWeb).toHaveBeenCalledWith(
      b,
      expect.objectContaining({ viewport: true, assignRefs: 'ephemeral' }),
      { transport: 'bidi' }
    )
  })

  it('stops trying classic execute on a BiDi browser once it failed', async () => {
    const actual = await vi.importActual<typeof snap>('@wdio/snapshot')
    vi.mocked(snap.collectWeb).mockImplementation(actual.collectWeb)
    const executeScript = vi.fn().mockRejectedValue(new Error('unsupported'))
    const execute = vi
      .fn()
      .mockResolvedValue({ tree: TREE, refs: REFS, counter: 1 })
    const b = browser({ isBidi: true, executeScript, execute })

    await getSnapshot(b)
    await getSnapshot(b)

    expect(executeScript).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(
      vi.mocked(snap.collectWeb).mock.calls.map((call) => call[2])
    ).toEqual([{ transport: 'classic-first' }, { transport: 'bidi' }])
  })
})

const ANDROID_XML = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy rotation="0">
  <android.widget.FrameLayout bounds="[0,0][1080,2400]">
    <android.widget.Button text="Start" content-desc="start" clickable="true" resource-id="com.x:id/start" bounds="[100,200][400,300]" />
  </android.widget.FrameLayout>
</hierarchy>`

function nativeBrowser() {
  return browser({
    capabilities: { platformName: 'Android' },
    getPageSource: vi.fn().mockResolvedValue(ANDROID_XML),
    getWindowSize: vi.fn().mockResolvedValue({ width: 1080, height: 2400 })
  })
}

it('parses a vendor-bag-only native session with the resolved platform', async () => {
  await getSnapshot(
    browser({
      capabilities: { 'bstack:options': { platformName: 'iOS' } },
      getPageSource: vi.fn().mockResolvedValue(ANDROID_XML)
    })
  )
  expect(vi.mocked(snap.collectWeb)).not.toHaveBeenCalled()
  expect(vi.mocked(snap.parseNativeSource).mock.calls[0][1]).toBe('ios')
})

describe('getSnapshot web/native routing (same as wdio session)', () => {
  it.each([
    ['Android app', { platformName: 'Android' }, 'native'],
    ['iOS app via appium: prefix', { 'appium:platformName': 'iOS' }, 'native'],
    ['macOS app', { platformName: 'mac' }, 'native'],
    ['Windows app', { platformName: 'Windows' }, 'native'],
    [
      'Android app with platformName only in a vendor bag',
      {
        'bstack:options': { platformName: 'Android' },
        'appium:automationName': 'UiAutomator2'
      },
      'native'
    ],
    [
      'Safari on iOS with both only in a vendor bag',
      { 'bstack:options': { platformName: 'iOS', browserName: 'Safari' } },
      'web'
    ],
    [
      'Chrome on Android',
      { platformName: 'Android', browserName: 'chrome' },
      'web'
    ],
    ['Safari on iOS', { platformName: 'iOS', browserName: 'Safari' }, 'web'],
    [
      'desktop Chrome on mac',
      { platformName: 'mac', browserName: 'chrome' },
      'web'
    ],
    [
      'desktop Chrome on linux',
      { platformName: 'linux', browserName: 'chrome' },
      'web'
    ]
  ])('%s is %s', async (_label, capabilities, expected) => {
    await getSnapshot(
      browser({
        capabilities,
        getPageSource: vi.fn().mockResolvedValue(ANDROID_XML)
      })
    )
    expect(vi.mocked(snap.collectWeb).mock.calls.length > 0).toBe(
      expected === 'web'
    )
  })
})

describe('getSnapshot (native)', () => {
  it('parses the page source without a viewport cut by default', async () => {
    const b = nativeBrowser()
    await getSnapshot(b)

    expect(snap.parseNativeSource).toHaveBeenCalledWith(
      ANDROID_XML,
      'android',
      {
        all: false,
        counter: 0
      }
    )
    expect(b.getWindowSize).not.toHaveBeenCalled()
    expect(snap.inViewport).not.toHaveBeenCalled()
    expect(snap.collectWeb).not.toHaveBeenCalled()
  })

  it('cuts to the window size when viewport is set, keeping the tree if nothing remains', async () => {
    const b = nativeBrowser()
    vi.mocked(snap.inViewport).mockReturnValue(undefined)
    await getSnapshot(b, { viewport: true })

    expect(snap.inViewport).toHaveBeenCalledWith(expect.anything(), 1080, 2400)
    const rendered = vi.mocked(snap.formatSnapshot).mock.calls[0][0]
    expect(rendered).toBe(vi.mocked(snap.attachSelectors).mock.calls[0][0])
  })

  it('renders refs with selectors from a real parse', async () => {
    const actual = await vi.importActual<typeof snap>('@wdio/snapshot')
    vi.mocked(snap.attachSelectors).mockImplementation(actual.attachSelectors)
    vi.mocked(snap.formatSnapshot).mockImplementation(actual.formatSnapshot)

    const { text, refs } = await getSnapshot(nativeBrowser())

    expect(refs.length).toBeGreaterThan(0)
    expect(text).toMatch(/\be1\b/)
    expect(text).toContain('→')
    expect(text).toContain('start')
  })

  it('parses an appium:-prefixed iOS session as iOS, not the android fallback', async () => {
    await getSnapshot(
      browser({
        capabilities: { 'appium:platformName': 'iOS' },
        getPageSource: vi
          .fn()
          .mockResolvedValue('<XCUIElementTypeApplication />')
      })
    )
    expect(vi.mocked(snap.parseNativeSource).mock.calls[0][1]).toBe('ios')
  })

  it('returns only the refs left in the tree after a viewport cut', async () => {
    const parsedRefs = [
      { id: 'e1', role: 'button', candidates: [] },
      { id: 'e2', role: 'button', candidates: [] }
    ]
    vi.mocked(snap.parseNativeSource).mockReturnValueOnce({
      tree: TREE,
      refs: parsedRefs,
      located: [],
      counter: 2
    })
    vi.mocked(snap.inViewport).mockReturnValue({
      role: 'application',
      children: [{ role: 'button', ref: 'e2' }]
    })

    const { refs } = await getSnapshot(nativeBrowser(), { viewport: true })

    expect(refs.map((ref) => ref.id)).toEqual(['e2'])
  })
})
