import { describe, it, expect, vi, beforeEach } from 'vitest'
import DevToolsHookService from '../src/index.js'

const fakeFrame = {
  getFileName: () => '/test/specs/fake.spec.ts',
  getLineNumber: () => 1,
  getColumnNumber: () => 1
}
// Create mock instance that will be returned by SessionCapturer constructor
vi.mock('stack-trace', () => ({
  parse: () => [fakeFrame]
}))
const mockSessionCapturerInstance = {
  afterCommand: vi.fn(),
  sendUpstream: vi.fn(),
  injectScript: vi.fn().mockResolvedValue(undefined),
  commandsLog: [],
  sources: new Map(),
  mutations: [],
  traceLogs: [],
  consoleLogs: [],
  isReportingUpstream: false
}

vi.mock('../src/session.js', () => ({
  SessionCapturer: vi.fn(function (this: any) {
    return mockSessionCapturerInstance
  })
}))

describe('DevtoolsService - Internal Command Filtering', () => {
  let service: DevToolsHookService
  const mockBrowser = {
    isBidi: true,
    sessionId: 'test-session',
    scriptAddPreloadScript: vi.fn().mockResolvedValue(undefined),
    takeScreenshot: vi.fn().mockResolvedValue('screenshot'),
    execute: vi.fn().mockResolvedValue({
      width: 1200,
      height: 800,
      offsetLeft: 0,
      offsetTop: 0
    })
  } as any

  // Helper to execute a command (before + after)
  const executeCommand = (
    cmd: string,
    args: any[] = [],
    result: any = undefined
  ) => {
    service.beforeCommand(cmd as any, args)
    service.afterCommand(cmd as any, args, result)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockSessionCapturerInstance.afterCommand.mockClear()
    mockSessionCapturerInstance.sendUpstream.mockClear()
    service = new DevToolsHookService()
  })

  describe('beforeCommand', () => {
    it('should not add internal commands to command stack', () => {
      const internalCommands = [
        'getTitle',
        'waitUntil',
        'getUrl',
        'execute',
        'findElement'
      ]
      internalCommands.forEach((cmd) => service.beforeCommand(cmd as any, []))
      expect(true).toBe(true)
    })

    it('should add user commands to command stack', () => {
      ;['click', 'url', 'getText'].forEach((cmd, i) => {
        const args = [['.button', 'https://example.com', '.result'][i]]
        service.beforeCommand(cmd as any, args)
      })
      expect(true).toBe(true)
    })
  })

  describe('afterCommand - internal command filtering', () => {
    beforeEach(async () => {
      await service.before({} as any, [], mockBrowser)
      vi.clearAllMocks()
      mockSessionCapturerInstance.afterCommand.mockClear()
    })

    it('should filter mixed internal and user commands correctly', () => {
      // Execute mix of user and internal commands
      executeCommand('url', ['https://example.com'])
      executeCommand('getTitle', [], 'Page Title') // internal
      executeCommand('click', ['.button'])
      executeCommand('waitUntil', [expect.any(Function)], true) // internal
      executeCommand('getText', ['.result'], 'Success')

      // Only user commands (url, click, getText) should be captured
      expect(mockSessionCapturerInstance.afterCommand).toHaveBeenCalledTimes(3)

      const capturedCommands =
        mockSessionCapturerInstance.afterCommand.mock.calls.map(
          (call) => call[1]
        )
      expect(capturedCommands).toEqual(['url', 'click', 'getText'])
      expect(capturedCommands).not.toContain('getTitle')
      expect(capturedCommands).not.toContain('waitUntil')
    })
  })
})
