import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { finalizeScreencast } from '../src/finalize-screencast.js'
import { ScreencastRecorderBase } from '../src/screencast.js'

// Mock the ffmpeg-bound encoder so tests don't shell out.
vi.mock('../src/video-encoder.js', () => ({
  encodeToVideo: vi.fn().mockResolvedValue(undefined)
}))

class StubRecorder extends ScreencastRecorderBase<{ name: string }> {
  stopped = false
  shouldStopThrow = false

  protected override async takeScreenshot() {
    return null
  }

  override async stop() {
    if (this.shouldStopThrow) {
      throw new Error('stop blew up')
    }
    this.stopped = true
  }

  setFrames(data: string[]) {
    this.buffer = data.map((d, i) => ({ data: d, timestamp: i * 100 }))
  }
}

let r: StubRecorder
let tmpDir: string
let sent: Array<{ scope: string; data: unknown }>
let logs: Array<{ level: string; message: string }>

beforeEach(() => {
  vi.clearAllMocks()
  r = new StubRecorder()
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finalize-screencast-'))
  sent = []
  logs = []
})

const baseOpts = () => ({
  recorder: r,
  sessionId: 'sess-abc',
  filenamePrefix: 'test-video',
  outputDir: tmpDir,
  sendUpstream: (scope: string, data: unknown) => sent.push({ scope, data }),
  onLog: (level: 'info' | 'warn', message: string) =>
    logs.push({ level, message })
})

describe('finalizeScreencast', () => {
  it('stops, encodes, broadcasts a screencast payload with the composed filename', async () => {
    r.setFrames(['f1', 'f2', 'f3'])
    await finalizeScreencast({ ...baseOpts(), filenamePrefix: 'my-prefix' })
    expect(r.stopped).toBe(true)
    expect(sent).toHaveLength(1)
    const payload = sent[0].data as Record<string, unknown>
    expect(payload.sessionId).toBe('sess-abc')
    expect(payload.frameCount).toBe(3)
    expect(payload.videoFile).toBe('my-prefix-sess-abc.webm')
    expect(payload.videoPath).toContain('my-prefix-sess-abc.webm')
  })

  it('returns early when frames < minFrames (ghost-session guard)', async () => {
    r.setFrames(['f1', 'f2'])
    await finalizeScreencast({ ...baseOpts(), minFrames: 5 })
    expect(sent).toHaveLength(0)
  })

  it('falls back to os.tmpdir when outputDir is not writable', async () => {
    r.setFrames(['f1'])
    await finalizeScreencast({
      ...baseOpts(),
      outputDir: '/nonexistent/path/that/does/not/exist'
    })
    const payload = sent[0].data as Record<string, string>
    expect(payload.videoPath.startsWith(os.tmpdir())).toBe(true)
  })

  it('swallows recorder.stop() errors with a warn log, never broadcasts', async () => {
    r.shouldStopThrow = true
    r.setFrames(['f1'])
    await expect(finalizeScreencast(baseOpts())).resolves.toBeUndefined()
    expect(sent).toHaveLength(0)
    expect(
      logs.find((l) => l.level === 'warn' && l.message.includes('stop failed'))
    ).toBeDefined()
  })

  it('swallows encoder rejections with a warn log, returns cleanly', async () => {
    const { encodeToVideo } = await import('../src/video-encoder.js')
    vi.mocked(encodeToVideo).mockRejectedValueOnce(new Error('ffmpeg gone'))
    r.setFrames(['f1', 'f2'])
    await expect(finalizeScreencast(baseOpts())).resolves.toBeUndefined()
    expect(
      logs.find(
        (l) => l.level === 'warn' && l.message.includes('encode failed')
      )
    ).toBeDefined()
  })
})
