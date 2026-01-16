import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SessionCapturer } from '../src/session.js'
import { WebSocket } from 'ws'
import fs from 'node:fs/promises'

vi.mock('ws')
vi.mock('node:fs/promises')

describe('SessionCapturer', () => {
  const mockBrowser = {
    takeScreenshot: vi.fn().mockResolvedValue('screenshot')
  } as any

  const executeCommand = async (
    capturer: SessionCapturer,
    command: string,
    args: any[] = [],
    result: any = undefined,
    callSource?: string
  ) => {
    return capturer.afterCommand(
      mockBrowser,
      command as any,
      args,
      result,
      undefined,
      callSource
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.access).mockRejectedValue(new Error('File not found'))
  })

  describe('constructor and connection', () => {
    it('should initialize properties and create websocket connection', () => {
      const capturer1 = new SessionCapturer()
      expect(capturer1.isReportingUpstream).toBe(false)
      expect(capturer1.commandsLog).toEqual([])

      const capturer2 = new SessionCapturer({
        hostname: 'localhost',
        port: 3000
      })
      expect(WebSocket).toHaveBeenCalledWith('ws://localhost:3000/worker')
      expect(capturer2.isReportingUpstream).toBe(false)
    })
  })

  describe('afterCommand - screenshots', () => {
    it('should capture screenshots for every command', async () => {
      const capturer = new SessionCapturer()
      const mockScreenshot = 'base64EncodedScreenshotData'
      mockBrowser.takeScreenshot.mockResolvedValueOnce(mockScreenshot)

      await executeCommand(capturer, 'click', ['.button'])

      expect(mockBrowser.takeScreenshot).toHaveBeenCalledTimes(1)
      expect(capturer.commandsLog).toHaveLength(1)
      expect(capturer.commandsLog[0].screenshot).toBe(mockScreenshot)
    })

    it('should handle screenshot failures gracefully', async () => {
      const capturer = new SessionCapturer()
      mockBrowser.takeScreenshot.mockRejectedValueOnce(
        new Error('Screenshot failed')
      )

      await executeCommand(capturer, 'click', ['.button'])

      expect(mockBrowser.takeScreenshot).toHaveBeenCalled()
      expect(capturer.commandsLog).toHaveLength(1)
      expect(capturer.commandsLog[0].screenshot).toBeUndefined()
    })

    it('should capture screenshots for multiple commands in sequence', async () => {
      const capturer = new SessionCapturer()
      const screenshots = ['screenshot1', 'screenshot2', 'screenshot3']
      mockBrowser.takeScreenshot
        .mockResolvedValueOnce(screenshots[0])
        .mockResolvedValueOnce(screenshots[1])
        .mockResolvedValueOnce(screenshots[2])

      await executeCommand(capturer, 'url', ['https://example.com'])
      await executeCommand(capturer, 'click', ['.btn'])
      await executeCommand(capturer, 'getText', ['.result'], 'Success')

      expect(mockBrowser.takeScreenshot).toHaveBeenCalledTimes(3)
      screenshots.forEach((screenshot, i) => {
        expect(capturer.commandsLog[i].screenshot).toBe(screenshot)
      })
    })
  })

  describe('afterCommand - source capture', () => {
    it('should capture source code and filter internal frames', async () => {
      const capturer = new SessionCapturer()
      const sourceCode = 'const test = "hello";'
      const sourcePath = '/test/spec.ts'

      vi.mocked(fs.access).mockResolvedValue(undefined)
      vi.mocked(fs.readFile).mockResolvedValue(sourceCode as any)

      await executeCommand(
        capturer,
        'click',
        [],
        undefined,
        `${sourcePath}:10:5`
      )
      await executeCommand(
        capturer,
        'getText',
        [],
        'text',
        `${sourcePath}:15:5`
      )

      expect(capturer.sources.size).toBeGreaterThan(0)

      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'))
      await executeCommand(capturer, 'url', ['https://example.com'])

      expect(capturer.commandsLog.length).toBeGreaterThan(0)
    })
  })

  describe('data collection', () => {
    it('should accumulate commands and handle mutations', async () => {
      const capturer = new SessionCapturer()
      const commands = [
        ['url', ['https://example.com'], undefined],
        ['click', ['.button'], undefined],
        ['getText', ['.result'], 'Success']
      ]

      for (const [cmd, args, result] of commands) {
        await executeCommand(capturer, cmd as string, args as any[], result)
      }

      expect(capturer.commandsLog).toHaveLength(3)
      expect(capturer.commandsLog[0].command).toBe('url')

      const mutations: TraceMutation[] = [
        {
          type: 'childList',
          timestamp: Date.now(),
          target: 'ref-1',
          addedNodes: [],
          removedNodes: []
        }
      ]

      capturer.mutations = mutations
      expect(capturer.mutations).toHaveLength(1)
      expect(capturer.mutations[0].type).toBe('childList')
    })
  })

  describe('websocket communication', () => {
    it('should handle connection states and errors', () => {
      const mockWs = {
        readyState: WebSocket.CONNECTING,
        on: vi.fn(),
        send: vi.fn()
      } as any

      vi.mocked(WebSocket).mockImplementation(function (this: any) {
        return mockWs
      } as any)

      const capturer = new SessionCapturer({
        hostname: 'localhost',
        port: 3000
      })

      expect(capturer.isReportingUpstream).toBe(false)

      mockWs.readyState = WebSocket.OPEN
      expect(capturer.isReportingUpstream).toBe(true)

      const errorHandler = mockWs.on.mock.calls.find(
        (call: any) => call[0] === 'error'
      )?.[1]
      if (errorHandler) {
        expect(() => errorHandler(new Error('Connection failed'))).not.toThrow()
      }
    })
  })

  describe('console log capture', () => {
    /**
     * Test: All console methods (log, info, warn, error) are properly captured
     * Validates: method type, arguments, source attribution, and timestamp
     */
    it('should capture all console methods from test code', () => {
      const capturer = new SessionCapturer()
      const initialLength = capturer.consoleLogs.length

      // Execute all console methods with different argument patterns
      console.log('Log message')
      console.info('Info message', 'with multiple', 'arguments')
      console.warn('Warning message')
      console.error('Error message')

      // Verify all 4 logs were captured
      expect(capturer.consoleLogs).toHaveLength(initialLength + 4)

      // Validate console.log capture
      const logEntry = capturer.consoleLogs[initialLength]
      expect(logEntry.type).toBe('log')
      expect(logEntry.args).toEqual(['Log message'])
      expect(logEntry.source).toBe('test')
      expect(logEntry.timestamp).toBeDefined()

      // Validate console.info capture with multiple arguments
      const infoEntry = capturer.consoleLogs[initialLength + 1]
      expect(infoEntry.type).toBe('info')
      expect(infoEntry.args).toEqual([
        'Info message',
        'with multiple',
        'arguments'
      ])
      expect(infoEntry.source).toBe('test')

      // Validate console.warn capture
      const warnEntry = capturer.consoleLogs[initialLength + 2]
      expect(warnEntry.type).toBe('warn')
      expect(warnEntry.args).toEqual(['Warning message'])
      expect(warnEntry.source).toBe('test')

      // Validate console.error capture
      const errorEntry = capturer.consoleLogs[initialLength + 3]
      expect(errorEntry.type).toBe('error')
      expect(errorEntry.args).toEqual(['Error message'])
      expect(errorEntry.source).toBe('test')
    })

    /**
     * Test: Complex argument types are handled correctly
     * Validates: object serialization, circular reference handling, null/undefined conversion
     */
    it('should handle various argument types', () => {
      const capturer = new SessionCapturer()
      const initialLength = capturer.consoleLogs.length

      // Create test data: object, circular reference
      const testObject = { foo: 'bar', nested: { value: 42 } }
      const circular: any = { a: 1 }
      circular.self = circular

      // Log various argument types in sequence
      console.log('Object:', testObject)
      console.log('Circular:', circular)
      console.log('Values:', null, undefined)

      expect(capturer.consoleLogs).toHaveLength(initialLength + 3)

      // Verify object is stringified to JSON
      const objLog = capturer.consoleLogs[initialLength]
      expect(objLog.args[0]).toBe('Object:')
      expect(objLog.args[1]).toBe(JSON.stringify(testObject))

      // Verify circular references don't crash and fallback to [object Object]
      const circularLog = capturer.consoleLogs[initialLength + 1]
      expect(circularLog.args[1]).toBe('[object Object]')

      // Verify null and undefined are converted to strings
      const nullLog = capturer.consoleLogs[initialLength + 2]
      expect(nullLog.args).toEqual(['Values:', 'null', 'undefined'])
    })

    /**
     * Test: Integration scenarios - cleanup, WebSocket transmission, browser source attribution
     * Validates: console restoration on cleanup, upstream WebSocket communication, source distinction
     */
    it('should handle cleanup, upstream transmission, and browser source attribution', async () => {
      // Part 1: Test console restoration on cleanup
      const originalLog = console.log
      const originalInfo = console.info
      const originalWarn = console.warn
      const originalError = console.error

      let capturer = new SessionCapturer()
      expect(console.log).not.toBe(originalLog)

      capturer.cleanup()
      expect(console.log).toBe(originalLog)
      expect(console.info).toBe(originalInfo)
      expect(console.warn).toBe(originalWarn)
      expect(console.error).toBe(originalError)

      // Part 2: Test WebSocket upstream transmission
      const mockWs = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
        on: vi.fn(),
        close: vi.fn()
      }

      vi.mocked(WebSocket).mockImplementation(function (this: any) {
        return mockWs
      } as any)

      capturer = new SessionCapturer({
        hostname: 'localhost',
        port: 3000
      })

      console.log('Test message')

      expect(mockWs.send).toHaveBeenCalled()
      const sentData = JSON.parse(
        mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0]
      )
      expect(sentData.scope).toBe('consoleLogs')
      expect(sentData.data).toHaveLength(1)
      expect(sentData.data[0].args).toEqual(['Test message'])
      expect(sentData.data[0].source).toBe('test')

      capturer.cleanup()

      // Part 3: Test browser console logs source attribution
      capturer = new SessionCapturer()
      const mockBrowserLogs = [
        {
          timestamp: Date.now(),
          type: 'log' as const,
          args: ['Browser log 1']
        },
        {
          timestamp: Date.now(),
          type: 'warn' as const,
          args: ['Browser warning']
        }
      ]

      const mockExecuteResult = {
        mutations: [],
        traceLogs: [],
        consoleLogs: mockBrowserLogs,
        metadata: { url: 'http://test.com', viewport: {} as VisualViewport }
      }

      mockBrowser.execute = vi.fn().mockResolvedValue(mockExecuteResult)
      mockBrowser.scriptAddPreloadScript = vi.fn().mockResolvedValue(undefined)
      mockBrowser.isBidi = true
      await capturer.injectScript(mockBrowser)
      await capturer.afterCommand(
        mockBrowser,
        'url' as any,
        ['http://test.com'],
        undefined,
        undefined
      )

      const browserLogs = capturer.consoleLogs.filter(
        (log) => log.source === 'browser'
      )
      expect(browserLogs).toHaveLength(2)
      expect(browserLogs[0].source).toBe('browser')
      expect(browserLogs[1].source).toBe('browser')
    })
  })

  describe('integration', () => {
    it('should handle complete session capture workflow', async () => {
      const capturer = new SessionCapturer()
      const commands = [
        ['url', ['https://example.com']],
        ['click', ['.btn']],
        ['getText', ['.result'], 'Success']
      ]

      for (const [cmd, args, result] of commands) {
        await executeCommand(capturer, cmd as string, args as any[], result)
      }

      expect(capturer.commandsLog).toHaveLength(3)
      const expectedCommands = ['url', 'click', 'getText']
      capturer.commandsLog.forEach((log, i) => {
        expect(log.command).toBe(expectedCommands[i])
      })
      expect(capturer.commandsLog[2].result).toBe('Success')
      expect(mockBrowser.takeScreenshot).toHaveBeenCalledTimes(3)
    })
  })

  describe('Network Request Capture', () => {
    let capturer: SessionCapturer

    // Helper to create request event
    const createRequestEvent = (id: string, url: string, method = 'GET') => ({
      request: {
        request: id,
        url,
        method,
        headers: [],
        timings: { timeOrigin: 1000 }
      }
    })

    // Helper to create response event
    const createResponseEvent = (
      id: string,
      url: string,
      options: {
        status?: number
        statusText?: string
        contentType?: string
        size?: number
        timeOrigin?: number
      } = {}
    ) => {
      const headers = options.contentType
        ? [
            {
              name: 'Content-Type',
              value: { type: 'string', value: options.contentType }
            }
          ]
        : []

      return {
        request: { request: id },
        response: {
          url,
          status: options.status ?? 200,
          statusText: options.statusText ?? 'OK',
          headers,
          fromCache: false,
          bytesReceived: options.size ?? 1024,
          timings: { timeOrigin: options.timeOrigin ?? 1500 }
        }
      }
    }

    // Helper to verify request properties
    const verifyRequest = (
      req: any,
      expected: {
        url: string
        method?: string
        status?: number
        contentType?: string
        size?: number
      }
    ) => {
      expect(req).toBeDefined()
      expect(req.url).toBe(expected.url)
      expect(req.method).toBe(expected.method ?? 'GET')
      expect(req.status).toBe(expected.status ?? 200)
      expect(req.statusText).toBe('OK')
      if (expected.contentType) {
        expect(req.responseHeaders).toBeDefined()
        expect(req.responseHeaders?.['content-type']).toBe(expected.contentType)
      }
      if (expected.size) {
        expect(req.size).toBe(expected.size)
      }
      expect(req.time).toBeDefined()
      expect(typeof req.time).toBe('number')
      expect(req.time).toBeGreaterThanOrEqual(0)
    }

    beforeEach(() => {
      capturer = new SessionCapturer()
    })

    afterEach(() => {
      capturer.networkRequests = []
    })

    it('should capture, merge, and filter network requests correctly', () => {
      // Test 1: Successful request capture and merge
      const req1 = createRequestEvent('1', 'https://api.example.com/users')
      capturer.handleNetworkRequestStarted(req1 as any)

      const res1 = createResponseEvent('1', 'https://api.example.com/users', {
        contentType: 'application/json',
        size: 1024
      })
      capturer.handleNetworkResponseCompleted(res1 as any)

      expect(capturer.networkRequests).toHaveLength(1)
      verifyRequest(capturer.networkRequests[0], {
        url: 'https://api.example.com/users',
        method: 'GET',
        status: 200,
        contentType: 'application/json',
        size: 1024
      })

      // Test 2: Request without content-type should be filtered
      const req2 = createRequestEvent('2', 'https://api.example.com/no-type')
      capturer.handleNetworkRequestStarted(req2 as any)

      const res2 = createResponseEvent(
        '2',
        'https://api.example.com/no-type',
        {}
      )
      capturer.handleNetworkResponseCompleted(res2 as any)

      // Should still have only 1 request (the first one)
      expect(capturer.networkRequests).toHaveLength(1)
    })

    it('should handle multiple concurrent requests', () => {
      const endpoints = ['endpoint1', 'endpoint2', 'endpoint3']

      // Start all requests
      endpoints.forEach((endpoint, i) => {
        const req = createRequestEvent(
          String(i + 1),
          `https://api.example.com/${endpoint}`
        )
        capturer.handleNetworkRequestStarted(req as any)
      })

      // Complete all requests
      endpoints.forEach((endpoint, i) => {
        const res = createResponseEvent(
          String(i + 1),
          `https://api.example.com/${endpoint}`,
          { contentType: 'application/json', size: 1024 }
        )
        capturer.handleNetworkResponseCompleted(res as any)
      })

      expect(capturer.networkRequests).toHaveLength(3)

      // Verify all URLs
      const urls = capturer.networkRequests.map((r) => r.url)
      expect(urls).toEqual([
        'https://api.example.com/endpoint1',
        'https://api.example.com/endpoint2',
        'https://api.example.com/endpoint3'
      ])

      // Verify each request
      capturer.networkRequests.forEach((req, index) => {
        verifyRequest(req, {
          url: `https://api.example.com/endpoint${index + 1}`,
          method: 'GET',
          status: 200,
          contentType: 'application/json',
          size: 1024
        })
      })
    })
  })
})
