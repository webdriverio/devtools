import { beforeEach, describe, expect, it, vi } from 'vitest'

const loaded = vi.hoisted(() => vi.fn())

vi.mock('../src/webdriverio-version.js', () => ({
  usesWdioSnapshot: vi.fn(() => false)
}))

vi.mock('../src/legacy-snapshot.js', () => ({
  getSnapshot: vi.fn(async () => ({ text: 'LEGACY', elements: {} }))
}))

vi.mock('../src/wdio-snapshot.js', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  resolvesWdioSnapshot: vi.fn(() => true)
}))

vi.mock('@wdio/snapshot', async (importActual) => {
  loaded()
  const actual = await importActual<typeof WdioSnapshot>()
  return { ...actual, collectWeb: vi.fn() }
})

import * as snap from '@wdio/snapshot'
import type * as WdioSnapshot from '@wdio/snapshot'
import { getSnapshot as getLegacySnapshot } from '../src/legacy-snapshot.js'
import { usesWdioSnapshot } from '../src/webdriverio-version.js'
import { resolvesWdioSnapshot } from '../src/wdio-snapshot.js'
import { getSnapshot, snapshotRenderer } from '../src/get-snapshot.js'

const browser = {
  capabilities: { browserName: 'chrome' },
  isBidi: false
} as unknown as WebdriverIO.Browser

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(usesWdioSnapshot).mockReturnValue(false)
  vi.mocked(resolvesWdioSnapshot).mockReturnValue(true)
})

describe('getSnapshot renderer routing', () => {
  it('renders legacy without loading @wdio/snapshot when the gate is closed', async () => {
    const result = await getSnapshot(browser)

    expect(result).toEqual({ format: 'legacy', text: 'LEGACY', elements: {} })
    expect(loaded).not.toHaveBeenCalled()
    expect(snap.collectWeb).not.toHaveBeenCalled()
  })

  it('picks the snapshot renderer only when the version gate and the resolver both pass', () => {
    expect(snapshotRenderer()).toBe('legacy')

    vi.mocked(usesWdioSnapshot).mockReturnValue(true)
    expect(snapshotRenderer()).toBe('snapshot')
  })

  it('renders legacy silently when @wdio/snapshot is not installed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(usesWdioSnapshot).mockReturnValue(true)
    vi.mocked(resolvesWdioSnapshot).mockReturnValue(false)

    const result = await getSnapshot(browser)

    expect(result).toEqual({ format: 'legacy', text: 'LEGACY', elements: {} })
    expect(snapshotRenderer()).toBe('legacy')
    expect(loaded).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it.each([
    [{}, true],
    [{ inViewportOnly: false }, false],
    [{ viewport: false }, false],
    [{ viewport: true, inViewportOnly: false }, true]
  ])(
    'maps options %j to the legacy viewport flag %s',
    async (options, expected) => {
      await getSnapshot(browser, options)

      expect(getLegacySnapshot).toHaveBeenCalledWith(browser, {
        inViewportOnly: expected
      })
    }
  )
})

describe('getSnapshot on the @wdio/snapshot renderer', () => {
  beforeEach(() => {
    vi.mocked(usesWdioSnapshot).mockReturnValue(true)
    vi.mocked(snap.collectWeb).mockResolvedValue({
      tree: {
        role: 'document',
        children: [{ role: 'button', name: 'Go', ref: 'e1' }]
      },
      refs: [
        {
          id: 'e1',
          role: 'button',
          name: 'Go',
          candidates: [{ kind: 'role', selector: 'button' }]
        }
      ],
      counter: 1
    } as never)
  })

  it('returns the snapshot format with elements keyed by ref id', async () => {
    const result = await getSnapshot(browser)

    expect(result.format).toBe('snapshot')
    expect(result.refs?.map((ref) => ref.id)).toEqual(['e1'])
    expect(result.elements).toEqual({
      e1: { selector: 'button', tagName: '', role: 'button', text: 'Go' }
    })
    expect(getLegacySnapshot).not.toHaveBeenCalled()
  })

  it.each([
    [{}, true],
    [{ inViewportOnly: false }, false],
    [{ viewport: false }, false],
    [{ viewport: true, inViewportOnly: false }, true]
  ])('maps options %j to the viewport flag %s', async (options, expected) => {
    await getSnapshot(browser, options)

    expect(snap.collectWeb).toHaveBeenCalledWith(
      browser,
      expect.objectContaining({ viewport: expected }),
      expect.anything()
    )
  })
})
