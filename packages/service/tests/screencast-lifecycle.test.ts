import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as DevtoolsCore from '@wdio/devtools-core'
import {
  ScreencastLifecycle,
  type ScreencastLifecycleContext
} from '../src/screencast-lifecycle.js'
import type { ServiceOptions } from '../src/types.js'

const recorder = {
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  setStartMarker: vi.fn(),
  frames: [] as Array<{ data: string; timestamp: number }>,
  duration: 0
}

vi.mock('../src/screencast.js', () => ({
  ScreencastRecorder: vi.fn(function () {
    // Every construction hands back the same stub, so a reload's "fresh"
    // recorder is observable through the shared frames array.
    recorder.frames = []
    return recorder
  })
}))

vi.mock('@wdio/devtools-core', async (importOriginal) => {
  const actual = await importOriginal<typeof DevtoolsCore>()
  return {
    ...actual,
    finalizeScreencast: vi.fn().mockResolvedValue(undefined),
    captureAndAttachVideo: vi.fn().mockResolvedValue(undefined)
  }
})

const browser = { sessionId: 'session-1' } as unknown as WebdriverIO.Browser
const capturer = { sendUpstream: vi.fn() }

const frame = (data: string, timestamp: number) => ({ data, timestamp })

function makeLifecycle(
  options: ServiceOptions,
  overrides: Partial<ScreencastLifecycleContext> = {}
) {
  const ctx: ScreencastLifecycleContext = {
    options,
    getBrowser: () => browser,
    getCapturer: () => capturer as never,
    getOutputDir: () => '/out',
    getTestUid: () => 'test-1',
    getTestStartWallTime: () => 1000,
    onArtifact: vi.fn(),
    log: vi.fn(),
    ...overrides
  }
  return { lifecycle: new ScreencastLifecycle(ctx), ctx }
}

beforeEach(() => {
  vi.clearAllMocks()
  recorder.frames = []
})

describe('ScreencastLifecycle.start', () => {
  it.each([
    ['live, no options', {}, false],
    ['live, screencast enabled', { screencast: { enabled: true } }, true],
    ['trace, filmstrip default-on', { mode: 'trace' }, true],
    [
      'trace, filmstrip off + no video',
      { mode: 'trace', filmstrip: false },
      false
    ],
    [
      'trace, filmstrip off + video on',
      { mode: 'trace', filmstrip: false, video: 'on' },
      true
    ],
    [
      'trace, filmstrip off + video off',
      { mode: 'trace', filmstrip: false, video: 'off' },
      false
    ]
  ])('%s → records: %s', async (_name, options, recording) => {
    const { lifecycle } = makeLifecycle(options as ServiceOptions)
    await lifecycle.start(browser)
    expect(recorder.start).toHaveBeenCalledTimes(recording ? 1 : 0)
  })
})

describe('ScreencastLifecycle filmstrip frames', () => {
  it('is undefined when filmstrip is off, so the trace stays byte-stable', () => {
    const { lifecycle } = makeLifecycle({ mode: 'trace', filmstrip: false })
    expect(lifecycle.filmstripFramesForExport()).toBeUndefined()
  })

  it('concatenates the live recorder onto frames drained from earlier sessions', async () => {
    const { lifecycle } = makeLifecycle({ mode: 'trace', filmstrip: true })
    await lifecycle.start(browser)
    recorder.frames = [frame('a', 1), frame('b', 2)]

    // A mid-run flush must see the still-recording session's frames.
    expect(lifecycle.filmstripFramesForExport()).toEqual([
      frame('a', 1),
      frame('b', 2)
    ])

    await lifecycle.handleReload('session-1')
    recorder.frames = [frame('c', 3)]

    // The recorder's buffer resets per session; the earlier frames survive only
    // because handleReload drained them into the run-scoped buffer.
    expect(lifecycle.filmstripFramesForExport()).toEqual([
      frame('a', 1),
      frame('b', 2),
      frame('c', 3)
    ])
  })
})

describe('ScreencastLifecycle.handleReload', () => {
  it('does nothing when recording is off', async () => {
    const { lifecycle } = makeLifecycle({ mode: 'trace', filmstrip: false })
    await lifecycle.handleReload('session-1')
    expect(recorder.stop).not.toHaveBeenCalled()
    expect(recorder.start).not.toHaveBeenCalled()
  })

  it('stops the dead session and starts a recorder on the new one', async () => {
    const { lifecycle } = makeLifecycle({ screencast: { enabled: true } })
    await lifecycle.start(browser)
    vi.clearAllMocks()
    recorder.frames = Array.from({ length: 10 }, (_, i) => frame('f', i))

    await lifecycle.handleReload('old-session')

    const { finalizeScreencast } = await import('@wdio/devtools-core')
    expect(finalizeScreencast).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'old-session', minFrames: 5 })
    )
    expect(recorder.start).toHaveBeenCalledWith(browser)
  })
})

describe('ScreencastLifecycle.attachTestVideo', () => {
  const videoOptions: ServiceOptions = {
    mode: 'trace',
    traceGranularity: 'test',
    video: 'on'
  }

  it('slices the frames snapshotted before reloadSession replaced the recorder', async () => {
    const { lifecycle } = makeLifecycle(videoOptions)
    await lifecycle.start(browser)
    recorder.frames = [frame('a', 1), frame('b', 2)]

    // The cucumber After hook reloads the session before afterScenario runs.
    await lifecycle.handleReload('old-session')
    recorder.frames = [frame('next-session', 9)]

    await lifecycle.attachTestVideo({
      testUid: 'test-1',
      attempt: 0,
      outcomes: [{ uid: 'test-1', attempt: 0, state: 'passed' }],
      attach: undefined
    })

    const { captureAndAttachVideo } = await import('@wdio/devtools-core')
    expect(captureAndAttachVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        testUid: 'test-1',
        frames: [frame('a', 1), frame('b', 2)],
        startWallTime: 1000,
        sessionId: 'session-1',
        outputDir: '/out'
      })
    )
  })

  it('falls back to the live recorder and consumes the pending slot once', async () => {
    const { lifecycle } = makeLifecycle(videoOptions)
    await lifecycle.start(browser)
    recorder.frames = [frame('a', 1)]
    await lifecycle.handleReload('old-session')
    recorder.frames = [frame('live', 5)]

    // A different test than the one the pending frames were keyed to: the
    // snapshot must not be handed to it, and it must not survive the read.
    await lifecycle.attachTestVideo({
      testUid: 'other-test',
      attempt: undefined,
      outcomes: [],
      attach: undefined
    })
    await lifecycle.attachTestVideo({
      testUid: 'test-1',
      attempt: undefined,
      outcomes: [],
      attach: undefined
    })

    const { captureAndAttachVideo } = await import('@wdio/devtools-core')
    expect(vi.mocked(captureAndAttachVideo).mock.calls[0]![0].frames).toEqual([
      frame('live', 5)
    ])
    expect(vi.mocked(captureAndAttachVideo).mock.calls[1]![0].frames).toEqual([
      frame('live', 5)
    ])
  })
})

describe('ScreencastLifecycle.finalize', () => {
  it('trace mode stops the recorder without encoding an orphan session video', async () => {
    const { lifecycle } = makeLifecycle({ mode: 'trace' })
    await lifecycle.start(browser)
    await lifecycle.finalize('session-1')

    const { finalizeScreencast } = await import('@wdio/devtools-core')
    expect(recorder.stop).toHaveBeenCalled()
    expect(finalizeScreencast).not.toHaveBeenCalled()
  })

  it('live mode encodes through the shared finalizer', async () => {
    const { lifecycle } = makeLifecycle({
      screencast: { enabled: true, captureFormat: 'png' }
    })
    await lifecycle.start(browser)
    await lifecycle.finalize('session-1')

    const { finalizeScreencast } = await import('@wdio/devtools-core')
    expect(finalizeScreencast).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        filenamePrefix: 'wdio-video',
        outputDir: '/out',
        minFrames: 5,
        captureFormat: 'png'
      })
    )
  })

  it('is a no-op when recording never started', async () => {
    const { lifecycle } = makeLifecycle({})
    await lifecycle.finalize('session-1')
    const { finalizeScreencast } = await import('@wdio/devtools-core')
    expect(finalizeScreencast).not.toHaveBeenCalled()
    expect(recorder.stop).not.toHaveBeenCalled()
  })
})

describe('ScreencastLifecycle option warnings', () => {
  it('warns that screencast.enabled is ignored in trace mode', () => {
    const log = vi.fn()
    makeLifecycle({ mode: 'trace', screencast: { enabled: true } }, { log })
    expect(log).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('`screencast.enabled` is ignored')
    )
  })

  it('stays quiet in live mode', () => {
    const log = vi.fn()
    makeLifecycle({ screencast: { enabled: true } }, { log })
    expect(log).not.toHaveBeenCalled()
  })

  it('markStart forwards to the recorder only while one exists', async () => {
    const { lifecycle } = makeLifecycle({ screencast: { enabled: true } })
    lifecycle.markStart()
    expect(recorder.setStartMarker).not.toHaveBeenCalled()
    await lifecycle.start(browser)
    lifecycle.markStart()
    expect(recorder.setStartMarker).toHaveBeenCalledTimes(1)
  })
})
