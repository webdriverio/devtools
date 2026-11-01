/**
 * Per-test video: slice the continuous screencast frame buffer to one test's
 * wall-clock window and encode that slice to a `.webm`. Framework-agnostic —
 * the adapter supplies the recorder's frames and the test's start time; the
 * recorder itself (CDP push on Chrome, screenshot polling elsewhere) lives in
 * each adapter. Best-effort: too few frames or a missing ffmpeg yields no
 * artifact rather than an error, so video never aborts a run.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { ScreencastFrame } from '@wdio/devtools-shared'
import { fileSlug } from './artifact-naming.js'
import { encodeToVideo } from './video-encoder.js'
import { errorMessage } from './error.js'
import type { TraceArtifact } from './trace-finalizer.js'

/** Frames captured at or after `startWallTime` (ms) — one test's window, since
 *  the buffer runs continuously and the next test's frames arrive later. */
export function sliceFramesFrom(
  frames: readonly ScreencastFrame[],
  startWallTime: number
): ScreencastFrame[] {
  return frames.filter((f) => f.timestamp >= startWallTime)
}

/**
 * Encode a test's frame slice to `<outputDir>/video-<uid>-<session>.webm` and
 * return the artifact. Returns undefined when there are too few frames to make
 * a video or when encoding fails (e.g. fluent-ffmpeg absent) — video is
 * best-effort and must never abort the run.
 */
export async function encodePerTestVideo(input: {
  frames: readonly ScreencastFrame[]
  outputDir: string
  testUid: string
  sessionId: string
  /** 0-based attempt; a `-retry<n>` suffix for n>0 keeps retries from
   *  overwriting each other's video (mirrors the trace slice's retry keys). */
  attempt?: number
  captureFormat?: 'jpeg' | 'png'
  minFrames?: number
  onLog?: (level: 'info' | 'warn', message: string) => void
}): Promise<TraceArtifact | undefined> {
  const minFrames = input.minFrames ?? 2
  if (input.frames.length < minFrames) {
    return undefined
  }
  await fs.mkdir(input.outputDir, { recursive: true })
  const retrySuffix = input.attempt ? `-retry${input.attempt}` : ''
  const filename = `video-${fileSlug(input.testUid)}-${input.sessionId.slice(0, 8)}${retrySuffix}.webm`
  const filePath = path.join(input.outputDir, filename)
  try {
    await encodeToVideo([...input.frames], filePath, {
      captureFormat: input.captureFormat
    })
  } catch (err) {
    input.onLog?.('warn', `Per-test video encode failed: ${errorMessage(err)}`)
    return undefined
  }
  return {
    kind: 'video',
    path: filePath,
    scope: 'test',
    key: input.testUid,
    testUids: [input.testUid],
    retained: true
  }
}
