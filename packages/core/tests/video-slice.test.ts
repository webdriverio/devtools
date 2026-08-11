import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ScreencastFrame } from '@wdio/devtools-shared'

const { encodeToVideo } = vi.hoisted(() => ({ encodeToVideo: vi.fn() }))
vi.mock('../src/video-encoder.js', () => ({ encodeToVideo }))

import { sliceFramesFrom, encodePerTestVideo } from '../src/video-slice.js'

const frames = (ts: number[]): ScreencastFrame[] =>
  ts.map((timestamp) => ({ data: 'AAAA', timestamp }))

describe('sliceFramesFrom', () => {
  it('keeps only frames at or after the window start', () => {
    const all = frames([100, 200, 300, 400])
    expect(sliceFramesFrom(all, 250).map((f) => f.timestamp)).toEqual([
      300, 400
    ])
  })

  it('returns all frames when start precedes them', () => {
    expect(sliceFramesFrom(frames([100, 200]), 0)).toHaveLength(2)
  })
})

describe('encodePerTestVideo', () => {
  const dirs: string[] = []
  beforeEach(() => encodeToVideo.mockReset())
  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))
    )
  })
  async function dir() {
    const d = await mkdtemp(join(tmpdir(), 'vid-'))
    dirs.push(d)
    return d
  }

  it('returns undefined below the min-frames threshold (no encode)', async () => {
    const artifact = await encodePerTestVideo({
      frames: frames([1]),
      outputDir: await dir(),
      testUid: 'u1',
      sessionId: 'sess1234'
    })
    expect(artifact).toBeUndefined()
    expect(encodeToVideo).not.toHaveBeenCalled()
  })

  it('encodes and returns a test-scoped video artifact', async () => {
    const d = await dir()
    encodeToVideo.mockResolvedValueOnce(undefined)
    const artifact = await encodePerTestVideo({
      frames: frames([1, 2, 3]),
      outputDir: d,
      testUid: 'my/test',
      sessionId: 'sess1234ef'
    })
    expect(artifact).toBeDefined()
    expect(artifact!.kind).toBe('video')
    expect(artifact!.scope).toBe('test')
    expect(artifact!.key).toBe('my/test')
    expect(artifact!.path).toMatch(/video-my-test-sess1234\.webm$/)
    expect(encodeToVideo).toHaveBeenCalledOnce()
  })

  it('suffixes the filename with the attempt so retries do not overwrite', async () => {
    encodeToVideo.mockResolvedValue(undefined)
    const a0 = await encodePerTestVideo({
      frames: frames([1, 2]),
      outputDir: await dir(),
      testUid: 'u1',
      sessionId: 'sess1234',
      attempt: 0
    })
    const a1 = await encodePerTestVideo({
      frames: frames([1, 2]),
      outputDir: await dir(),
      testUid: 'u1',
      sessionId: 'sess1234',
      attempt: 1
    })
    expect(a0!.path).toMatch(/video-u1-sess1234\.webm$/)
    expect(a1!.path).toMatch(/video-u1-sess1234-retry1\.webm$/)
  })

  it('returns undefined (no throw) when the encoder fails', async () => {
    encodeToVideo.mockRejectedValueOnce(new Error('ffmpeg missing'))
    const artifact = await encodePerTestVideo({
      frames: frames([1, 2, 3]),
      outputDir: await dir(),
      testUid: 'u1',
      sessionId: 'sess1234'
    })
    expect(artifact).toBeUndefined()
  })
})
