import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ScreencastRecorder } from '../src/screencast.js'

vi.mock('@wdio/logger', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn()
  }
  return { default: vi.fn(() => mockLogger) }
})

/** Helper: create a CDP-backed recorder with a frame handler ref. */
function createCdpSetup() {
  let frameHandler: (event: any) => void
  const cdpSession = {
    send: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((event: string, handler: any) => {
      if (event === 'Page.screencastFrame') {
        frameHandler = handler
      }
    })
  }
  const browser = {
    getPuppeteer: vi.fn().mockResolvedValue({
      pages: vi
        .fn()
        .mockResolvedValue([
          { createCDPSession: vi.fn().mockResolvedValue(cdpSession) }
        ])
    })
  } as any

  const pushFrame = (data: string, timestampSec: number, sessionId = 1) =>
    frameHandler({ data, metadata: { timestamp: timestampSec }, sessionId })

  return { browser, cdpSession, pushFrame }
}

describe('ScreencastRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('CDP mode: start → collect frames with acks → stop', async () => {
    const { browser, cdpSession, pushFrame } = createCdpSetup()
    const recorder = new ScreencastRecorder()

    // Start
    await recorder.start(browser)
    expect(recorder.isRecording).toBe(true)
    expect(cdpSession.send).toHaveBeenCalledWith(
      'Page.startScreencast',
      expect.objectContaining({ format: 'jpeg', quality: 70 })
    )

    // Collect frames — timestamps are converted from seconds to ms
    pushFrame('frame1', 1.0, 1)
    pushFrame('frame2', 2.5, 2)
    expect(recorder.frames).toHaveLength(2)
    expect(recorder.frames[0]).toEqual({ data: 'frame1', timestamp: 1000 })
    expect(recorder.frames[1]).toEqual({ data: 'frame2', timestamp: 2500 })
    expect(cdpSession.send).toHaveBeenCalledWith('Page.screencastFrameAck', {
      sessionId: 1
    })

    // Duration
    expect(recorder.duration).toBe(1500)

    // Stop
    await recorder.stop()
    expect(recorder.isRecording).toBe(false)
    expect(cdpSession.send).toHaveBeenCalledWith('Page.stopScreencast')

    // Stop again — no-op, no throw
    await recorder.stop()
  })

  it('polling mode: fallback when CDP unavailable → collect at interval → stop', async () => {
    vi.useFakeTimers()
    const browser = {
      getPuppeteer: vi.fn().mockRejectedValue(new Error('No puppeteer')),
      takeScreenshot: vi
        .fn()
        .mockResolvedValueOnce('shot1')
        .mockResolvedValueOnce('shot2')
        .mockResolvedValueOnce('shot3')
    } as any

    const recorder = new ScreencastRecorder({ pollIntervalMs: 200 })
    await recorder.start(browser)

    // Immediate first frame + recording started
    expect(recorder.isRecording).toBe(true)
    expect(recorder.frames).toHaveLength(1)
    expect(recorder.frames[0].data).toBe('shot1')

    // Interval ticks collect more frames
    await vi.advanceTimersByTimeAsync(200)
    expect(recorder.frames).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(200)
    expect(recorder.frames).toHaveLength(3)

    await recorder.stop()
    expect(recorder.isRecording).toBe(false)
    vi.useRealTimers()
  })

  it('polling: screenshot failure stops timer, initial failure skips recording', async () => {
    // Mid-polling failure — timer cleared, no more frames
    vi.useFakeTimers()
    const failBrowser = {
      getPuppeteer: vi.fn().mockRejectedValue(new Error('No puppeteer')),
      takeScreenshot: vi
        .fn()
        .mockResolvedValueOnce('ok')
        .mockRejectedValueOnce(new Error('Session ended'))
        .mockResolvedValueOnce('should-not-appear')
    } as any

    const rec1 = new ScreencastRecorder({ pollIntervalMs: 200 })
    await rec1.start(failBrowser)
    await vi.advanceTimersByTimeAsync(200) // failure tick
    const countAfterError = rec1.frames.length
    await vi.advanceTimersByTimeAsync(200) // timer should be cleared
    expect(rec1.frames).toHaveLength(countAfterError)
    vi.useRealTimers()

    // Initial screenshot fails — recording never starts
    const noBrowser = {
      getPuppeteer: vi.fn().mockRejectedValue(new Error('No puppeteer')),
      takeScreenshot: vi.fn().mockRejectedValue(new Error('Not supported'))
    } as any
    const rec2 = new ScreencastRecorder()
    await rec2.start(noBrowser)
    expect(rec2.isRecording).toBe(false)
    expect(rec2.frames).toEqual([])
  })

  it('setStartMarker trims leading frames and is idempotent', async () => {
    const { browser, pushFrame } = createCdpSetup()
    const recorder = new ScreencastRecorder()
    await recorder.start(browser)

    // 2 blank frames before marker
    pushFrame('blank1', 1.0)
    pushFrame('blank2', 2.0)
    recorder.setStartMarker()

    // 2 meaningful frames
    pushFrame('page1', 5.0)
    recorder.setStartMarker() // second call — ignored
    pushFrame('page2', 8.0)

    // Only post-marker frames returned
    expect(recorder.frames).toHaveLength(2)
    expect(recorder.frames[0].data).toBe('page1')
    expect(recorder.frames[1].data).toBe('page2')

    // Duration based on trimmed frames: 8000 - 5000
    expect(recorder.duration).toBe(3000)
  })

  it('stop is safe when never started', async () => {
    const recorder = new ScreencastRecorder()
    expect(recorder.duration).toBe(0)
    await expect(recorder.stop()).resolves.toBeUndefined()
  })
})
