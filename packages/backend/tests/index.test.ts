import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { start } from '../src/index.js'
import * as utils from '../src/utils.js'

vi.mock('../src/utils.js', () => ({
  getDevtoolsApp: vi.fn()
}))

vi.mock('ws')

describe('backend index', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Clean up any running servers
  })

  describe('start', () => {
    it('should handle start errors', async () => {
      vi.mocked(utils.getDevtoolsApp).mockRejectedValue(
        new Error('Package not found')
      )
      await expect(start()).rejects.toThrow('Package not found')
    })
  })

  describe('API endpoints', () => {
    it('should handle test run and stop requests with validation', async () => {
      vi.mocked(utils.getDevtoolsApp).mockResolvedValue('/mock/app/path')
      const server = await start({ port: 0 })
      const { testRunner } = await import('../src/runner.js')
      const runSpy = vi.spyOn(testRunner, 'run').mockResolvedValue()
      const stopSpy = vi.spyOn(testRunner, 'stop')

      // Test invalid payload - missing uid
      const invalidResponse = await server?.inject({
        method: 'POST',
        url: '/api/tests/run',
        payload: { entryType: 'test' }
      })
      expect(invalidResponse?.statusCode).toBe(400)
      expect(JSON.parse(invalidResponse?.body || '{}')).toEqual({
        error: 'Invalid run payload'
      })
      expect(runSpy).not.toHaveBeenCalled()

      // Test valid run request with all parameters
      const runPayload = {
        uid: 'test-123',
        entryType: 'test',
        specFile: '/test.spec.ts'
      }
      const runResponse = await server?.inject({
        method: 'POST',
        url: '/api/tests/run',
        payload: runPayload
      })
      expect(runResponse?.statusCode).toBe(200)
      expect(JSON.parse(runResponse?.body || '{}')).toEqual({ ok: true })
      expect(runSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          uid: 'test-123',
          entryType: 'test',
          specFile: '/test.spec.ts',
          devtoolsHost: expect.any(String),
          devtoolsPort: expect.any(Number)
        })
      )

      // Test stop request
      const stopResponse = await server?.inject({
        method: 'POST',
        url: '/api/tests/stop'
      })
      expect(stopResponse?.statusCode).toBe(200)
      expect(JSON.parse(stopResponse?.body || '{}')).toEqual({ ok: true })
      expect(stopSpy).toHaveBeenCalled()

      await server?.close()
    })

    it('should handle test run errors gracefully', async () => {
      vi.mocked(utils.getDevtoolsApp).mockResolvedValue('/mock/app/path')
      const server = await start({ port: 0 })
      const { testRunner } = await import('../src/runner.js')
      vi.spyOn(testRunner, 'run').mockRejectedValue(
        new Error('Test execution failed')
      )

      const response = await server?.inject({
        method: 'POST',
        url: '/api/tests/run',
        payload: {
          uid: 'test-456',
          entryType: 'test',
          specFile: '/test.spec.ts'
        }
      })

      expect(response?.statusCode).toBe(500)
      expect(JSON.parse(response?.body || '{}')).toEqual({
        error: 'Test execution failed'
      })

      await server?.close()
    })
  })
})
