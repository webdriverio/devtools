import { describe, it, expect, vi } from 'vitest'
import { getBrowserAccessibilityTree } from '../src/accessibility-tree.js'

describe('getBrowserAccessibilityTree', () => {
  it('calls browser.execute and returns result', async () => {
    const nodes = [
      {
        role: 'button',
        name: 'Submit',
        selector: 'button*=Submit',
        depth: 0,
        level: '',
        disabled: '',
        checked: '',
        expanded: '',
        selected: '',
        pressed: '',
        required: '',
        readonly: ''
      }
    ]
    const mockBrowser = { execute: vi.fn().mockResolvedValue(nodes) } as any
    const result = await getBrowserAccessibilityTree(mockBrowser)
    expect(mockBrowser.execute).toHaveBeenCalledTimes(1)
    expect(result).toEqual(nodes)
  })
})
