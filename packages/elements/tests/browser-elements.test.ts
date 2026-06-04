import { describe, it, expect, vi } from 'vitest'
import { getInteractableBrowserElements } from '../src/browser-elements.js'

describe('getInteractableBrowserElements', () => {
  it('calls browser.execute with includeBounds=false by default', async () => {
    const mockBrowser = { execute: vi.fn().mockResolvedValue([]) } as any
    const result = await getInteractableBrowserElements(mockBrowser)
    expect(mockBrowser.execute).toHaveBeenCalledTimes(1)
    expect(result).toEqual([])
  })

  it('passes includeBounds option to script', async () => {
    const mockBrowser = {
      execute: vi.fn().mockResolvedValue([{ tagName: 'button', name: 'OK' }])
    } as any
    const result = await getInteractableBrowserElements(mockBrowser, {
      includeBounds: true
    })
    expect(result).toHaveLength(1)
    expect(result[0].tagName).toBe('button')
  })
})
