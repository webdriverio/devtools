import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import logger from '@wdio/logger'
import { errorMessage } from '@wdio/devtools-core'
import { encodeToVideo } from './videoEncoder.js'
import type { ScreencastRecorder } from '../screencast.js'

const log = logger('@wdio/selenium-devtools:finalizeScreencast')

export interface FinalizeScreencastInput {
  screencast: ScreencastRecorder
  sessionId: string
  testFileDir?: string
  captureFormat?: 'jpeg' | 'png'
  /** Callback used to forward the encoded-video metadata to the dashboard.
   *  Provided as a function so this helper doesn't depend on SessionCapturer. */
  sendUpstream: (scope: string, data: unknown) => void
}

/**
 * Stop the screencast recorder, encode its frames to a `.webm` next to the
 * test file (or cwd / os tmpdir as fallbacks), and forward the resulting
 * path to the dashboard. All errors are caught and logged — screencast is a
 * best-effort feature that must not abort the run on encode failure.
 */
export async function finalizeScreencast({
  screencast,
  sessionId,
  testFileDir,
  captureFormat,
  sendUpstream
}: FinalizeScreencastInput): Promise<void> {
  try {
    await screencast.stop()
  } catch (err) {
    log.warn(`Screencast stop failed: ${errorMessage(err)}`)
    return
  }
  const frames = screencast.frames
  if (frames.length === 0) {
    return
  }
  const fileName = `selenium-video-${sessionId}.webm`
  // Output dir priority: test-file dir → cwd → os.tmpdir().
  const candidate = testFileDir || process.cwd()
  let videoPath = path.join(candidate, fileName)
  try {
    fs.accessSync(candidate, fs.constants.W_OK)
  } catch {
    videoPath = path.join(os.tmpdir(), fileName)
  }
  try {
    await encodeToVideo(frames, videoPath, { captureFormat })
    log.info(`📹 Screencast video: ${videoPath}`)
    sendUpstream('screencast', {
      sessionId,
      videoPath,
      videoFile: fileName,
      frameCount: frames.length
    })
  } catch (err) {
    log.warn(`Screencast encode failed: ${errorMessage(err)}`)
  }
}
