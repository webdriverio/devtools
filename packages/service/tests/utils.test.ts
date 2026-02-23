import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getBrowserObject, setCurrentSpecFile } from '../src/utils.js'

describe('service utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setCurrentSpecFile(undefined)
  })

  describe('getBrowserObject', () => {
    it('should return browser directly or traverse hierarchy', () => {
      const mockBrowser = {
        sessionId: 'session-123',
        capabilities: {}
      } as WebdriverIO.Browser

      // Direct browser object
      expect(getBrowserObject(mockBrowser)).toBe(mockBrowser)

      // Single level
      const element1 = {
        elementId: 'element-1',
        parent: mockBrowser
      } as unknown as WebdriverIO.Element
      expect(getBrowserObject(element1)).toBe(mockBrowser)

      // Multiple levels
      const element2 = {
        elementId: 'element-2',
        parent: element1
      } as unknown as WebdriverIO.Element
      expect(getBrowserObject(element2)).toBe(mockBrowser)
    })
  })

  describe('setCurrentSpecFile', () => {
    it('should set and clear spec file without errors', () => {
      expect(() => setCurrentSpecFile('/path/to/test.spec.ts')).not.toThrow()
      expect(() => setCurrentSpecFile(undefined)).not.toThrow()
    })
  })
})
