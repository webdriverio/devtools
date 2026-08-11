import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ScreencastInfo } from '@wdio/devtools-shared'

import type { ScreencastRecorderBase } from './screencast.js'
import { errorMessage } from './error.js'
import { encodeToVideo } from './video-encoder.js'

export interface FinalizeScreencastInput {
  recorder: ScreencastRecorderBase
  sessionId: string
  /** Filename without the .webm suffix (e.g. 'wdio-video', 'selenium-video'). */
  filenamePrefix: string
  /** Preferred output dir; falls back to cwd, then os.tmpdir() if unwritable. */
  outputDir?: string
  /** Skip encoding when the recorder collected fewer frames than this. */
  minFrames?: number
  captureFormat?: 'jpeg' | 'png'
  /** Forward the encoded-video metadata to the dashboard. */
  sendUpstream: (scope: string, data: ScreencastInfo) => void
  /** Optional hook for adapter-side logging on each lifecycle step. */
  onLog?: (level: 'info' | 'warn', message: string) => void
}

/**
 * Stop the recorder, encode its frames to a `.webm` (preferred dir → cwd →
 * tmpdir), and forward the metadata to the dashboard. All errors are caught
 * and reported via `onLog` — screencast is best-effort and must not abort the
 * run on stop/encode failure.
 *
 * Shared across all three adapters: each one provides only the recorder
 * subclass, the filename prefix, and a sendUpstream binding to its
 * SessionCapturer.
 */
export async function finalizeScreencast({
  recorder,
  sessionId,
  filenamePrefix,
  outputDir,
  minFrames = 1,
  captureFormat,
  sendUpstream,
  onLog
}: FinalizeScreencastInput): Promise<void> {
  const log = (level: 'info' | 'warn', message: string) =>
    onLog?.(level, message)

  try {
    await recorder.stop()
  } catch (err) {
    log('warn', `Screencast stop failed: ${errorMessage(err)}`)
    return
  }

  const frames = recorder.frames
  if (frames.length < minFrames) {
    return
  }

  const fileName = `${filenamePrefix}-${sessionId}.webm`
  const candidate = outputDir || process.cwd()
  let videoPath = path.join(candidate, fileName)
  try {
    // Create the (test-results) dir if absent, then confirm it's writable;
    // fall back to tmpdir on any failure so a bad path never aborts the run.
    fs.mkdirSync(candidate, { recursive: true })
    fs.accessSync(candidate, fs.constants.W_OK)
  } catch {
    videoPath = path.join(os.tmpdir(), fileName)
  }

  try {
    await encodeToVideo(frames, videoPath, { captureFormat })
    log('info', `📹 Screencast video: ${videoPath}`)
    sendUpstream('screencast', {
      sessionId,
      videoPath,
      videoFile: fileName,
      frameCount: frames.length,
      duration: recorder.duration,
      startTime: frames[0]?.timestamp
    })
  } catch (err) {
    log('warn', `Screencast encode failed: ${errorMessage(err)}`)
  }
}
