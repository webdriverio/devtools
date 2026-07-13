import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import {
  getBrowserObject,
  isUserSpecFile,
  setCurrentSpecFile
} from '../src/utils.js'

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

  describe('isUserSpecFile', () => {
    it('returns false for empty / null / undefined paths', () => {
      expect(isUserSpecFile(null)).toBe(false)
      expect(isUserSpecFile(undefined)).toBe(false)
      expect(isUserSpecFile('')).toBe(false)
    })

    it('rejects node-builtin protocol paths', () => {
      expect(isUserSpecFile('node:fs')).toBe(false)
      expect(isUserSpecFile('node:internal/modules/cjs/loader')).toBe(false)
    })

    it('rejects paths under node_modules', () => {
      expect(isUserSpecFile('/proj/node_modules/some-lib/dist/index.js')).toBe(
        false
      )
    })

    it('accepts user spec files outside node_modules', () => {
      expect(isUserSpecFile('/proj/test/login.spec.ts')).toBe(true)
      expect(isUserSpecFile('/proj/src/features/auth.feature')).toBe(true)
    })

    it('preserves @wdio/expect-webdriverio even when inside node_modules', () => {
      // Users may want to step into expect matchers when debugging.
      expect(
        isUserSpecFile(
          '/proj/node_modules/@wdio/expect-webdriverio/build/matchers/element/toBeDisplayed.js'
        )
      ).toBe(true)
    })

    it('normalizes Windows-style backslashes before checking node_modules', () => {
      expect(
        isUserSpecFile('C:\\proj\\node_modules\\some-lib\\dist\\index.js')
      ).toBe(false)
      expect(isUserSpecFile('C:\\proj\\test\\login.spec.ts')).toBe(true)
    })

    it('decodes file:// URLs (incl. percent-encoding) before matching', () => {
      expect(isUserSpecFile('file:///proj/test/login%20spec.ts')).toBe(true)
      expect(isUserSpecFile('file:///proj/node_modules/lib/index.js')).toBe(
        false
      )
    })

    it("excludes the service's own bundle dir, plain and as a file:// frame", () => {
      // SELF_DIR is the dir this module resolves from; at test time that's
      // packages/service/src. A frame from there is instrumentation, not a spec.
      const selfDir = fileURLToPath(new URL('../src/', import.meta.url))
      expect(isUserSpecFile(`${selfDir}index.js`)).toBe(false)
      expect(isUserSpecFile(`file://${selfDir}session.js`)).toBe(false)
    })
  })
})
