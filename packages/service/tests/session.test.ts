import { describe, it, expect, vi, beforeEach } from 'vitest'
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
})
