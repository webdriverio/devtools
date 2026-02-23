import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DevToolsAppLauncher } from '../src/launcher.js'
import * as backend from '@wdio/devtools-backend'
import { remote } from 'webdriverio'

vi.mock('@wdio/devtools-backend', () => ({
  start: vi.fn()
}))

vi.mock('webdriverio', () => ({
  remote: vi.fn()
}))

vi.mock('@wdio/logger', () => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn()
  }
  const loggerFunc: any = vi.fn(() => mockLogger)
  loggerFunc.setLevel = vi.fn()
  return {
    default: loggerFunc
  }
})

describe('DevToolsAppLauncher', () => {
  const mockServer = { address: () => ({ port: 3000 }) }
  const mockBrowser = {
    url: vi.fn().mockResolvedValue(undefined),
    getTitle: vi.fn().mockResolvedValue('Test'),
    deleteSession: vi.fn().mockResolvedValue(undefined)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.DEVTOOLS_APP_REUSE
    delete process.env.DEVTOOLS_APP_PORT
    delete process.env.DEVTOOLS_APP_HOST
    mockBrowser.url.mockResolvedValue(undefined)
    mockBrowser.getTitle.mockResolvedValue('Test')
    mockBrowser.deleteSession.mockResolvedValue(undefined)
  })

  describe('onPrepare', () => {
    it('should start devtools backend and update capabilities', async () => {
      vi.mocked(backend.start).mockResolvedValue({ server: mockServer } as any)
      vi.mocked(remote).mockResolvedValue(mockBrowser as any)

      const launcher = new DevToolsAppLauncher({ port: 3000 })
      const caps = [{ browserName: 'chrome' }] as any

      await launcher.onPrepare(undefined as never, caps)

      expect(backend.start).toHaveBeenCalledWith({
        port: 3000,
        hostname: undefined
      })
      expect(caps[0]['wdio:devtoolsOptions']).toEqual({
        port: 3000,
        hostname: 'localhost'
      })
      expect(remote).toHaveBeenCalled()
      expect(mockBrowser.url).toHaveBeenCalledWith('http://localhost:3000')
    })

    it('should use custom hostname', async () => {
      const customServer = { address: () => ({ port: 4000 }) }
      vi.mocked(backend.start).mockResolvedValue({
        server: customServer
      } as any)
      vi.mocked(remote).mockResolvedValue(mockBrowser as any)

      const launcher = new DevToolsAppLauncher({
        hostname: '127.0.0.1',
        port: 4000
      })
      const caps = [{ browserName: 'chrome' }] as any

      await launcher.onPrepare(undefined as never, caps)

      expect(caps[0]['wdio:devtoolsOptions']).toEqual({
        port: 4000,
        hostname: '127.0.0.1'
      })
    })

    it('should reuse existing devtools app when DEVTOOLS_APP_REUSE is set', async () => {
      process.env.DEVTOOLS_APP_REUSE = '1'
      process.env.DEVTOOLS_APP_PORT = '5000'
      process.env.DEVTOOLS_APP_HOST = 'localhost'

      const launcher = new DevToolsAppLauncher({ port: 3000 })
      const caps = [{ browserName: 'chrome' }] as any

      await launcher.onPrepare(undefined as never, caps)

      // Should not start new server
      expect(backend.start).not.toHaveBeenCalled()

      // Should use existing port
      expect(caps[0]['wdio:devtoolsOptions']).toEqual({
        port: 5000,
        hostname: 'localhost'
      })
    })

    it('should handle server start failure', async () => {
      vi.mocked(backend.start).mockRejectedValue(new Error('Failed to start'))

      const launcher = new DevToolsAppLauncher({ port: 3000 })
      const caps = [{ browserName: 'chrome' }] as any

      // Should not throw, just log error
      await expect(
        launcher.onPrepare(undefined as never, caps)
      ).resolves.toBeUndefined()
    })

    it('should handle missing port in server address', async () => {
      const mockServer = {
        address: () => null
      }

      vi.mocked(backend.start).mockResolvedValue({ server: mockServer } as any)

      const launcher = new DevToolsAppLauncher({ port: 3000 })
      const caps = [{ browserName: 'chrome' }] as any

      await launcher.onPrepare(undefined as never, caps)

      // Should handle gracefully
      expect(backend.start).toHaveBeenCalled()
    })

    it('should not update non-array capabilities', async () => {
      const mockServer = {
        address: () => ({ port: 3000 })
      }

      vi.mocked(backend.start).mockResolvedValue({ server: mockServer } as any)

      const launcher = new DevToolsAppLauncher({ port: 3000 })
      const caps: any = {
        browserName: 'chrome'
      }

      await launcher.onPrepare(undefined as never, caps)

      // Should not throw or modify non-array caps
      expect(caps['wdio:devtoolsOptions']).toBeUndefined()
    })

    it('should update multiple capabilities', async () => {
      vi.mocked(backend.start).mockResolvedValue({ server: mockServer } as any)
      vi.mocked(remote).mockResolvedValue(mockBrowser as any)

      const launcher = new DevToolsAppLauncher({ port: 3000 })
      const caps = [
        { browserName: 'chrome' },
        { browserName: 'firefox' },
        { browserName: 'edge' }
      ] as any

      await launcher.onPrepare(undefined as never, caps)

      caps.forEach((cap: any) => {
        expect(cap['wdio:devtoolsOptions']).toEqual({
          port: 3000,
          hostname: 'localhost'
        })
      })
    })

    it('should pass devtoolsCapabilities to remote', async () => {
      vi.mocked(backend.start).mockResolvedValue({ server: mockServer } as any)
      vi.mocked(remote).mockResolvedValue(mockBrowser as any)

      const customCaps = {
        browserName: 'chrome',
        'goog:chromeOptions': { args: ['--headless'] }
      }

      const launcher = new DevToolsAppLauncher({
        port: 3000,
        devtoolsCapabilities: customCaps
      })
      const caps = [{ browserName: 'chrome' }] as any

      await launcher.onPrepare(undefined as never, caps)

      expect(remote).toHaveBeenCalledWith(
        expect.objectContaining({
          automationProtocol: 'devtools',
          capabilities: expect.objectContaining(customCaps)
        })
      )
    })
  })

  describe('onComplete', () => {
    it('should wait for browser window to close', async () => {
      let getTitleCallCount = 0
      mockBrowser.getTitle.mockImplementation(() => {
        getTitleCallCount++
        return getTitleCallCount <= 1
          ? Promise.resolve('Test')
          : Promise.reject(new Error('Browser closed'))
      })

      vi.mocked(backend.start).mockResolvedValue({ server: mockServer } as any)
      vi.mocked(remote).mockResolvedValue(mockBrowser as any)

      const launcher = new DevToolsAppLauncher({ port: 3000 })
      const caps = [{ browserName: 'chrome' }] as any

      await launcher.onPrepare(undefined as never, caps)
      await launcher.onComplete()

      expect(mockBrowser.getTitle).toHaveBeenCalled()
      expect(mockBrowser.deleteSession).toHaveBeenCalled()
      vi.useRealTimers()
    }, 10000)

    it('should handle no browser instance', async () => {
      const launcher = new DevToolsAppLauncher({ port: 3000 })

      // Should not throw
      await expect(launcher.onComplete()).resolves.toBeUndefined()
    })

    it('should handle deleteSession errors', async () => {
      mockBrowser.getTitle.mockRejectedValue(new Error('Browser closed'))
      mockBrowser.deleteSession.mockRejectedValue(
        new Error('Session already closed')
      )

      vi.mocked(backend.start).mockResolvedValue({ server: mockServer } as any)
      vi.mocked(remote).mockResolvedValue(mockBrowser as any)

      const launcher = new DevToolsAppLauncher({ port: 3000 })
      const caps = [{ browserName: 'chrome' }] as any

      await launcher.onPrepare(undefined as never, caps)
      await expect(launcher.onComplete()).resolves.toBeUndefined()
    })
  })

  describe('integration', () => {
    it('should handle full lifecycle', async () => {
      mockBrowser.getTitle.mockRejectedValue(new Error('Browser closed'))

      vi.mocked(backend.start).mockResolvedValue({ server: mockServer } as any)
      vi.mocked(remote).mockResolvedValue(mockBrowser as any)

      const launcher = new DevToolsAppLauncher({
        port: 3000,
        hostname: 'localhost'
      })
      const caps = [{ browserName: 'chrome' }] as any

      await launcher.onPrepare(undefined as never, caps)

      expect(backend.start).toHaveBeenCalled()
      expect(remote).toHaveBeenCalled()
      expect(mockBrowser.url).toHaveBeenCalledWith('http://localhost:3000')
      expect(caps[0]['wdio:devtoolsOptions']).toBeDefined()

      await launcher.onComplete()
      expect(mockBrowser.deleteSession).toHaveBeenCalled()
    })
  })
})
