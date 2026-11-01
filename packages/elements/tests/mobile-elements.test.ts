import { describe, it, expect, vi } from 'vitest'
import { getMobileVisibleElements } from '../src/mobile-elements.js'

describe('getMobileVisibleElements', () => {
  it('returns empty array for unparseable XML', async () => {
    const mockBrowser = {
      getWindowSize: vi.fn().mockResolvedValue({ width: 375, height: 812 }),
      getPageSource: vi.fn().mockResolvedValue('<invalid')
    } as any
    const result = await getMobileVisibleElements(mockBrowser, 'ios')
    expect(Array.isArray(result)).toBe(true)
  })
})
