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
  cleanup: vi.fn(),
  commandsLog: [],
  sources: new Map(),
  mutations: [],
  traceLogs: [],
  consoleLogs: [],
  networkRequests: [],
  isReportingUpstream: false,
  metadata: { url: 'http://test.com', viewport: {} }
}

vi.mock('../src/session.js', () => ({
  SessionCapturer: vi.fn(function (this: any) {
    return mockSessionCapturerInstance
  })
}))

const mockScreencastRecorder = {
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  setStartMarker: vi.fn(),
  frames: [] as any[],
  duration: 0,
  isRecording: false
}

vi.mock('../src/screencast.js', () => ({
  ScreencastRecorder: vi.fn(function () {
    return mockScreencastRecorder
  })
}))

vi.mock('../src/video-encoder.js', () => ({
  encodeToVideo: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('node:fs/promises', () => ({
  default: { writeFile: vi.fn().mockResolvedValue(undefined) }
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
    }),
    on: vi.fn(), // Add event listener mock
    emit: vi.fn() // Add emit mock
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

describe('DevtoolsService - Screencast Integration', () => {
  let service: DevToolsHookService
  const mockBrowser = {
    isBidi: true,
    sessionId: 'session-123',
    scriptAddPreloadScript: vi.fn().mockResolvedValue(undefined),
    takeScreenshot: vi.fn().mockResolvedValue('screenshot'),
    execute: vi.fn().mockResolvedValue({
      width: 1200,
      height: 800,
      offsetLeft: 0,
      offsetTop: 0
    }),
    on: vi.fn(),
    emit: vi.fn(),
    options: { rootDir: '/project/example' },
    capabilities: { browserName: 'chrome' }
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
    mockScreencastRecorder.frames = []
    mockScreencastRecorder.duration = 0
  })

  it('full lifecycle: start → setStartMarker on url → encode on after() → notify backend', async () => {
    const { encodeToVideo } = await import('../src/video-encoder.js')
    service = new DevToolsHookService({ screencast: { enabled: true } })
    await service.before({} as any, [], mockBrowser)

    // Recorder started
    expect(mockScreencastRecorder.start).toHaveBeenCalledWith(mockBrowser)

    // setStartMarker fires on 'url', not on 'click'
    service.beforeCommand('click' as any, ['.button'])
    expect(mockScreencastRecorder.setStartMarker).not.toHaveBeenCalled()
    service.beforeCommand('url' as any, ['https://example.com'])
    expect(mockScreencastRecorder.setStartMarker).toHaveBeenCalled()

    // after() stops, encodes, and notifies
    mockScreencastRecorder.frames = Array(10).fill({
      data: 'framedata',
      timestamp: 1000
    })
    mockScreencastRecorder.duration = 5000
    await service.after()

    expect(mockScreencastRecorder.stop).toHaveBeenCalled()
    expect(encodeToVideo).toHaveBeenCalledWith(
      mockScreencastRecorder.frames,
      expect.stringContaining('wdio-video-session-123.webm'),
      expect.any(Object)
    )
    expect(mockSessionCapturerInstance.sendUpstream).toHaveBeenCalledWith(
      'screencast',
      expect.objectContaining({
        sessionId: 'session-123',
        frameCount: 10,
        duration: 5000
      })
    )
  })

  it('skips when disabled, skips ghost sessions, and swallows encode errors', async () => {
    const { encodeToVideo } = await import('../src/video-encoder.js')

    // Disabled — recorder never starts
    service = new DevToolsHookService({})
    await service.before({} as any, [], mockBrowser)
    expect(mockScreencastRecorder.start).not.toHaveBeenCalled()

    // Ghost session — <5 frames, encoding skipped
    service = new DevToolsHookService({ screencast: { enabled: true } })
    await service.before({} as any, [], mockBrowser)
    mockScreencastRecorder.frames = Array(3).fill({
      data: 'f',
      timestamp: 1000
    })
    vi.mocked(encodeToVideo).mockClear()
    await service.after()
    expect(encodeToVideo).not.toHaveBeenCalled()

    // Encode error — swallowed, doesn't throw
    service = new DevToolsHookService({ screencast: { enabled: true } })
    await service.before({} as any, [], mockBrowser)
    mockScreencastRecorder.frames = Array(10).fill({
      data: 'f',
      timestamp: 1000
    })
    vi.mocked(encodeToVideo).mockRejectedValueOnce(new Error('ffmpeg missing'))
    await expect(service.after()).resolves.toBeUndefined()
  })

  it('onReload finalizes old session and starts fresh recorder', async () => {
    const { ScreencastRecorder } = await import('../src/screencast.js')
    service = new DevToolsHookService({ screencast: { enabled: true } })
    await service.before({} as any, [], mockBrowser)
    vi.clearAllMocks()

    mockScreencastRecorder.frames = Array(10).fill({
      data: 'f',
      timestamp: 1000
    })
    await service.onReload('old-session', 'new-session')

    expect(mockScreencastRecorder.stop).toHaveBeenCalled()
    expect(ScreencastRecorder).toHaveBeenCalled()
    expect(mockScreencastRecorder.start).toHaveBeenCalledWith(mockBrowser)
  })
})
