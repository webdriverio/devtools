import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'

import { encodeToVideo } from '../src/video-encoder.js'
import type { ScreencastFrame } from '../src/types.js'

vi.mock('@wdio/logger', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn()
  }
  return { default: vi.fn(() => mockLogger) }
})

const mockFfmpegInstance = {
  input: vi.fn().mockReturnThis(),
  inputOptions: vi.fn().mockReturnThis(),
  videoCodec: vi.fn().mockReturnThis(),
  outputOptions: vi.fn().mockReturnThis(),
  output: vi.fn().mockReturnThis(),
  on: vi.fn().mockReturnThis(),
  run: vi.fn()
}
const mockFfmpeg = vi.fn(() => mockFfmpegInstance)

vi.mock('node:module', () => ({
  createRequire: vi.fn(() => {
    return (moduleName: string) => {
      if (moduleName === 'fluent-ffmpeg') {
        return mockFfmpeg
      }
      throw new Error(`Cannot find module '${moduleName}'`)
    }
  })
}))

vi.mock('node:fs/promises')
vi.mock('node:os', () => ({
  default: { tmpdir: vi.fn(() => '/tmp') }
}))

const makeFrames = (timestamps: number[]): ScreencastFrame[] =>
  timestamps.map((ts, i) => ({
    data: Buffer.from(`frame-${i}`).toString('base64'),
    timestamp: ts
  }))

describe('encodeToVideo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fs.mkdtemp).mockResolvedValue('/tmp/wdio-screencast-abc123')
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.rm).mockResolvedValue(undefined)

    mockFfmpegInstance.on.mockImplementation(function (
      this: typeof mockFfmpegInstance,
      event: string,
      handler: any
    ) {
      if (event === 'end') {
        ;(this as any)._endHandler = handler
      }
      if (event === 'error') {
        ;(this as any)._errorHandler = handler
      }
      return this
    })
    mockFfmpegInstance.run.mockImplementation(function (
      this: typeof mockFfmpegInstance
    ) {
      ;(this as any)._endHandler?.()
    })
  })

  it('should throw when no frames are provided', async () => {
    await expect(encodeToVideo([], '/out/video.webm')).rejects.toThrow(
      'no frames to encode'
    )
  })

  it('should write frames, build manifest with correct durations, and invoke ffmpeg', async () => {
    const frames = makeFrames([1000, 1500, 2200])
    await encodeToVideo(frames, '/out/video.webm')

    // Temp dir created
    expect(fs.mkdtemp).toHaveBeenCalledWith(
      path.join('/tmp', 'wdio-screencast-')
    )

    // 3 frame files + 1 manifest = 4 writes
    expect(fs.writeFile).toHaveBeenCalledTimes(4)
    expect(fs.writeFile).toHaveBeenCalledWith(
      '/tmp/wdio-screencast-abc123/frame-000000.jpg',
      expect.any(Buffer)
    )

    // Manifest has correct variable-rate durations
    const manifestCall = vi
      .mocked(fs.writeFile)
      .mock.calls.find((call) => String(call[0]).includes('manifest.txt'))
    const manifest = String(manifestCall![1])
    expect(manifest).toContain('ffconcat version 1.0')
    expect(manifest).toContain('duration 0.500000') // 1000→1500
    expect(manifest).toContain('duration 0.700000') // 1500→2200
    expect(manifest).toContain('duration 0.100000') // last frame default

    // ffmpeg called with VP8 codec
    expect(mockFfmpegInstance.videoCodec).toHaveBeenCalledWith('libvpx')
    expect(mockFfmpegInstance.output).toHaveBeenCalledWith('/out/video.webm')

    // Temp dir cleaned up
    expect(fs.rm).toHaveBeenCalledWith('/tmp/wdio-screencast-abc123', {
      recursive: true,
      force: true
    })
  })

  it('should clean up temp dir and surface helpful error on ffmpeg failure', async () => {
    // Missing ffmpeg binary
    mockFfmpegInstance.run.mockImplementation(function (
      this: typeof mockFfmpegInstance
    ) {
      ;(this as any)._errorHandler?.(new Error('Cannot find ffmpeg'))
    })

    await expect(
      encodeToVideo(makeFrames([1000]), '/out/video.webm')
    ).rejects.toThrow('ffmpeg binary not found')

    // Temp dir still cleaned up on failure
    expect(fs.rm).toHaveBeenCalledWith('/tmp/wdio-screencast-abc123', {
      recursive: true,
      force: true
    })
  })
})
