import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/webdriverio-version.js', () => ({
  usesWdioSnapshot: vi.fn(() => true)
}))

vi.mock('../src/legacy-snapshot.js', () => ({
  getSnapshot: vi.fn(async () => ({ text: 'LEGACY', elements: {} }))
}))

vi.mock('../src/wdio-snapshot.js', async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  resolvesWdioSnapshot: vi.fn(() => true)
}))

vi.mock('@wdio/snapshot', () => {
  throw new Error('module graph broken')
})

import { getSnapshot, snapshotRenderer } from '../src/get-snapshot.js'

describe('getSnapshot when @wdio/snapshot cannot load', () => {
  it('falls back to the legacy renderer and logs the failure once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const browser = { capabilities: {} } as unknown as WebdriverIO.Browser

    const first = await getSnapshot(browser)
    await getSnapshot(browser)

    expect(first).toEqual({ format: 'legacy', text: 'LEGACY', elements: {} })
    expect(snapshotRenderer()).toBe('legacy')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('could not load @wdio/snapshot')
    warn.mockRestore()
  })
})
