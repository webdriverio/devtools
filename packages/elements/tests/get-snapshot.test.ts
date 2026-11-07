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

vi.mock('../src/webdriverio-version.js', () => ({
  usesWdioSnapshot: vi.fn(() => true)
}))

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
  it('collects the viewport by default and renders with selectors', async () => {
    const b = browser({ isBidi: true })
    const result = await getSnapshot(b)

    expect(snap.collectWeb).toHaveBeenCalledWith(
      b,
      {
        counter: 0,
        all: false,
        boxes: false,
        viewport: true,
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
    expect(result).toEqual(
      expect.objectContaining({ format: 'snapshot', text: 'TEXT', refs: REFS })
    )
  })

  it('passes viewport through, and uses the bidi transport on a classic session', async () => {
    const b = browser({ isBidi: false })
    await getSnapshot(b, { inViewportOnly: true })

    expect(snap.collectWeb).toHaveBeenCalledWith(
      b,
      expect.objectContaining({ viewport: true, assignRefs: 'ephemeral' }),
      { transport: 'bidi' }
    )
  })

  it('stops trying classic execute on a BiDi browser after one failure, as the CLI does', async () => {
    const actual = await vi.importActual<typeof snap>('@wdio/snapshot')
    vi.mocked(snap.collectWeb).mockImplementation(actual.collectWeb)
    const executeScript = vi.fn().mockRejectedValue(new Error('unsupported'))
    const execute = vi
      .fn()
      .mockResolvedValue({ tree: TREE, refs: REFS, counter: 1 })
    const b = browser({ isBidi: true, executeScript, execute })

    await getSnapshot(b)
    await getSnapshot(b)
    await getSnapshot(b)

    expect(executeScript).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledTimes(3)
    expect(
      vi.mocked(snap.collectWeb).mock.calls.map((call) => call[2])
    ).toEqual([
      { transport: 'classic-first' },
      { transport: 'bidi' },
      { transport: 'bidi' }
    ])
  })

  it('tries classic again after reloadSession starts a new session on the same browser', async () => {
    const actual = await vi.importActual<typeof snap>('@wdio/snapshot')
    vi.mocked(snap.collectWeb).mockImplementation(actual.collectWeb)
    const b = browser({
      isBidi: true,
      sessionId: 'first',
      executeScript: vi.fn().mockRejectedValue(new Error('unsupported')),
      execute: vi.fn().mockResolvedValue({ tree: TREE, refs: REFS, counter: 1 })
    })

    await getSnapshot(b)
    await getSnapshot(b)
    ;(b as { sessionId: string }).sessionId = 'second'
    await getSnapshot(b)

    expect(
      vi.mocked(snap.collectWeb).mock.calls.map((call) => call[2])
    ).toEqual([
      { transport: 'classic-first' },
      { transport: 'bidi' },
      { transport: 'classic-first' }
    ])
  })

  it('omits a ref whose selector is not printed from elements but keeps it in refs', async () => {
    const tree = {
      role: 'document',
      children: [{ role: 'button', ref: 'e1', selector: '#go' }]
    } as unknown as snap.SnapshotNode
    const refs = [
      { id: 'e1', role: 'button', name: 'go', candidates: [] },
      { id: 'e2', role: 'button', name: 'stale', candidates: [] }
    ] as unknown as snap.SnapshotRef[]
    vi.mocked(snap.collectWeb).mockResolvedValueOnce({
      tree,
      refs,
      counter: 2
    } as never)

    const result = await getSnapshot(browser({ isBidi: false }))

    expect(result.elements).toEqual({
      e1: { selector: '#go', tagName: '', role: 'button', text: 'go' }
    })
    expect(result.refs).toEqual(refs)
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

it('renders the full native tree when the window size cannot be read', async () => {
  const b = browser({
    capabilities: { platformName: 'Android' },
    getPageSource: vi.fn().mockResolvedValue(ANDROID_XML),
    getWindowSize: vi.fn().mockRejectedValue(new Error('no window'))
  })

  const result = await getSnapshot(b)

  expect(result.format).toBe('snapshot')
  expect(snap.inViewport).not.toHaveBeenCalled()
  expect(snap.formatSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({ role: expect.any(String) }),
    expect.anything()
  )
})

it('returns an empty snapshot and warns when the page source cannot be read', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const result = await getSnapshot(
      browser({
        capabilities: { platformName: 'Android' },
        getPageSource: vi.fn().mockRejectedValue(new Error('no session'))
      })
    )

    expect(result).toEqual({
      format: 'snapshot',
      text: '[No elements found]',
      elements: {},
      refs: []
    })
    expect(warn).toHaveBeenCalledWith(
      '@wdio/elements: could not read the page source: no session'
    )
  } finally {
    warn.mockRestore()
  }
})

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
  it('cuts the page source to the viewport by default', async () => {
    const b = nativeBrowser()
    vi.mocked(snap.inViewport).mockReturnValue(undefined)
    await getSnapshot(b)

    expect(snap.parseNativeSource).toHaveBeenCalledWith(
      ANDROID_XML,
      'android',
      {
        all: false,
        counter: 0
      }
    )
    expect(b.getWindowSize).toHaveBeenCalled()
    expect(snap.inViewport).toHaveBeenCalledWith(expect.anything(), 1080, 2400)
    expect(snap.collectWeb).not.toHaveBeenCalled()
  })

  it('renders the full page source when viewport is false', async () => {
    const b = nativeBrowser()
    await getSnapshot(b, { inViewportOnly: false })

    expect(b.getWindowSize).not.toHaveBeenCalled()
    expect(snap.inViewport).not.toHaveBeenCalled()
    expect(snap.collectWeb).not.toHaveBeenCalled()
  })

  it('cuts to the window size when viewport is set, keeping the tree if nothing remains', async () => {
    const b = nativeBrowser()
    vi.mocked(snap.inViewport).mockReturnValue(undefined)
    await getSnapshot(b, { inViewportOnly: true })

    expect(snap.inViewport).toHaveBeenCalledWith(expect.anything(), 1080, 2400)
    const rendered = vi.mocked(snap.formatSnapshot).mock.calls[0][0]
    const parsed = vi.mocked(snap.parseNativeSource).mock.results[0].value
    expect(rendered).toBe(parsed.tree)
    expect(rendered).toBe(vi.mocked(snap.attachSelectors).mock.calls[0][0])
  })

  it('renders refs with selectors from a real parse', async () => {
    const actual = await vi.importActual<typeof snap>('@wdio/snapshot')
    vi.mocked(snap.attachSelectors).mockImplementation(actual.attachSelectors)
    vi.mocked(snap.formatSnapshot).mockImplementation(actual.formatSnapshot)

    const { text, refs = [] } = await getSnapshot(nativeBrowser())

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

    const { refs = [] } = await getSnapshot(nativeBrowser(), {
      inViewportOnly: true
    })

    expect(refs.map((ref) => ref.id)).toEqual(['e2'])
  })

  it('keeps the whole parsed tree when the window reports a zero size', async () => {
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
    const b = browser({
      capabilities: { platformName: 'Android' },
      getPageSource: vi.fn().mockResolvedValue(ANDROID_XML),
      getWindowSize: vi.fn().mockResolvedValue({ width: 0, height: 0 })
    })

    const { refs = [] } = await getSnapshot(b, { inViewportOnly: true })

    expect(snap.inViewport).not.toHaveBeenCalled()
    expect(refs.map((ref) => ref.id)).toEqual(['e1', 'e2'])
  })
})
