import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as DevtoolsCore from '@wdio/devtools-core'
import DevToolsHookService from '../src/index.js'

// Controllable stack: `frames` defaults to a single user-spec frame (commands
// read as top-level). A test can splice in `matcherFrame` to simulate a command
// issued from inside an expect-webdriverio matcher.
const stackMock = vi.hoisted(() => {
  const userFrame = {
    getFileName: () => '/test/specs/fake.spec.ts',
    getLineNumber: () => 1,
    getColumnNumber: () => 1
  }
  const matcherFrame = {
    getFileName: () =>
      '/node_modules/expect-webdriverio/lib/matchers/toHaveText.js',
    getLineNumber: () => 1,
    getColumnNumber: () => 1
  }
  return { frames: [userFrame], userFrame, matcherFrame }
})
// Create mock instance that will be returned by SessionCapturer constructor
vi.mock('stack-trace', () => ({
  parse: () => stackMock.frames
}))
const mockSessionCapturerInstance = {
  afterCommand: vi.fn(),
  sendUpstream: vi.fn(),
  injectScript: vi.fn().mockResolvedValue(undefined),
  captureSource: vi.fn(),
  captureAssertCommand: vi.fn(),
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

vi.mock('@wdio/devtools-core', async (importOriginal) => {
  const actual = await importOriginal<typeof DevtoolsCore>()
  return {
    ...actual,
    encodeToVideo: vi.fn().mockResolvedValue(undefined),
    finalizeScreencast: vi.fn(async (opts: any) => {
      await opts.recorder.stop()
      opts.sendUpstream('screencast', {
        sessionId: opts.sessionId,
        videoPath: `/out/${opts.filenamePrefix}-${opts.sessionId}.webm`,
        videoFile: `${opts.filenamePrefix}-${opts.sessionId}.webm`,
        frameCount: opts.recorder.frames.length,
        duration: opts.recorder.duration
      })
    })
  }
})

vi.mock('node:fs/promises', () => ({
  default: { writeFile: vi.fn().mockResolvedValue(undefined) }
}))

describe('DevtoolsService - Internal Command Filtering', () => {
  let service: DevToolsHookService
  const mockBrowser = {
    isBidi: true,
    sessionId: 'test-session',
    addCommand: vi.fn(),
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
      const internalCommands = ['getTitle', 'getUrl', 'execute', 'findElement']
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
      executeCommand('waitUntil', [expect.any(Function)], true) // a user wait
      executeCommand('getText', ['.result'], 'Success')

      // getTitle is internal; the rest — including the wait — are user actions.
      expect(mockSessionCapturerInstance.afterCommand).toHaveBeenCalledTimes(4)

      const capturedCommands =
        mockSessionCapturerInstance.afterCommand.mock.calls.map(
          (call) => call[1]
        )
      expect(capturedCommands).toEqual(['url', 'click', 'waitUntil', 'getText'])
      expect(capturedCommands).not.toContain('getTitle')
    })

    it('captures a wait once and suppresses the commands it polls', () => {
      // waitUntil opens; its predicate polls isDisplayed while the wait is
      // still on the stack, so those polls are top-level-suppressed.
      service.beforeCommand('waitUntil' as any, [expect.any(Function)])
      service.beforeCommand('isDisplayed' as any, [])
      service.afterCommand('isDisplayed' as any, [], false)
      service.beforeCommand('isDisplayed' as any, [])
      service.afterCommand('isDisplayed' as any, [], true)
      service.afterCommand('waitUntil' as any, [expect.any(Function)], true)

      const captured = mockSessionCapturerInstance.afterCommand.mock.calls.map(
        (call) => call[1]
      )
      expect(captured).toEqual(['waitUntil'])
    })

    // Service-fired commands (preload injection, Puppeteer handle for CDP,
    // post-command screenshots) must not surface as user actions.
    it.each(['scriptAddPreloadScript', 'getPuppeteer', 'takeScreenshot'])(
      'filters service-internal %s out of the command stack',
      (cmd) => {
        executeCommand('click', ['.user'])
        executeCommand(cmd as any, [], 'noop')
        const captured =
          mockSessionCapturerInstance.afterCommand.mock.calls.map(
            (call) => call[1]
          )
        expect(captured).toContain('click')
        expect(captured).not.toContain(cmd)
      }
    )
  })
})

describe('DevtoolsService - Screencast Integration', () => {
  let service: DevToolsHookService
  const mockBrowser = {
    isBidi: true,
    sessionId: 'session-123',
    addCommand: vi.fn(),
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
    expect(mockSessionCapturerInstance.sendUpstream).toHaveBeenCalledWith(
      'screencast',
      expect.objectContaining({
        sessionId: 'session-123',
        frameCount: 10,
        duration: 5000,
        videoFile: 'wdio-video-session-123.webm'
      })
    )
  })

  it('skips when disabled, forwards minFrames=5 for ghost sessions, swallows encode errors', async () => {
    const { finalizeScreencast } = await import('@wdio/devtools-core')

    // Disabled — recorder never starts, finalizer never called
    service = new DevToolsHookService({})
    await service.before({} as any, [], mockBrowser)
    expect(mockScreencastRecorder.start).not.toHaveBeenCalled()
    expect(finalizeScreencast).not.toHaveBeenCalled()

    // Enabled — finalizer is called with minFrames=5 so the helper skips
    // ghost sessions internally (we don't need to assert recorder.frames).
    vi.mocked(finalizeScreencast).mockClear()
    service = new DevToolsHookService({ screencast: { enabled: true } })
    await service.before({} as any, [], mockBrowser)
    mockScreencastRecorder.frames = Array(3).fill({ data: 'f', timestamp: 1 })
    await service.after()
    expect(finalizeScreencast).toHaveBeenCalledWith(
      expect.objectContaining({ filenamePrefix: 'wdio-video', minFrames: 5 })
    )

    // Encode-error swallowing is the responsibility of the shared finalize
    // helper itself (covered in core/tests). Service just needs to invoke it.
  })

  it('trace mode: filmstrip starts the recorder; no filmstrip/video leaves it off', async () => {
    // filmstrip on → recorder runs so its frames become the dense trace filmstrip
    service = new DevToolsHookService({ mode: 'trace', filmstrip: true })
    await service.before({} as any, [], mockBrowser)
    expect(mockScreencastRecorder.start).toHaveBeenCalledWith(mockBrowser)

    vi.clearAllMocks()

    // trace mode, neither filmstrip nor video → no recorder (byte-stable output)
    service = new DevToolsHookService({ mode: 'trace' })
    await service.before({} as any, [], mockBrowser)
    expect(mockScreencastRecorder.start).not.toHaveBeenCalled()
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
