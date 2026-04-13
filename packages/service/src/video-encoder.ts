import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'

import logger from '@wdio/logger'

import type { ScreencastFrame, ScreencastOptions } from './types.js'

// fluent-ffmpeg uses `export =` (CommonJS). With module:NodeNext, dynamic
// import() of such modules doesn't resolve .default correctly in TypeScript.
// createRequire is the idiomatic way to load CJS modules in ESM.
const require = createRequire(import.meta.url)

const log = logger('@wdio/devtools-service:VideoEncoder')

/**
 * Encodes an array of CDP screencast frames into a .webm video file using
 * ffmpeg (via fluent-ffmpeg) and the VP8 codec (libvpx).
 *
 * Strategy:
 *   1. Write each frame as a JPEG (or PNG) file in a temp directory.
 *   2. Write an ffconcat manifest that assigns each frame its exact display
 *      duration based on the inter-frame timestamp delta. This produces a
 *      variable-frame-rate video that accurately reflects real timing even
 *      when commands cause long pauses between frames.
 *   3. Run ffmpeg with the concat demuxer → libvpx (VP8) → .webm output.
 *   4. Clean up the temp directory regardless of success or failure.
 *
 * @throws If no frames are provided, if fluent-ffmpeg is not installed, or if
 *         the ffmpeg binary is not found on PATH.
 */
export async function encodeToVideo(
  frames: ScreencastFrame[],
  outputPath: string,
  options: Pick<ScreencastOptions, 'captureFormat'> = {}
): Promise<void> {
  if (frames.length === 0) {
    throw new Error('VideoEncoder: no frames to encode')
  }

  // Load fluent-ffmpeg via require so TypeScript is happy with the export=
  // style module. Wrap in try/catch for a clear missing-package message.
  // fluent-ffmpeg is an optional peer dependency so we use `any` here.

  let ffmpeg: any
  try {
    ffmpeg = require('fluent-ffmpeg')
  } catch {
    throw new Error(
      'VideoEncoder: fluent-ffmpeg is required for screencast encoding. ' +
        'Install it with: npm install fluent-ffmpeg'
    )
  }

  const ext = options.captureFormat === 'png' ? 'png' : 'jpg'
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wdio-screencast-'))

  try {
    // ── Step 1: write frame files ──────────────────────────────────────────
    const manifestLines: string[] = ['ffconcat version 1.0']

    for (let i = 0; i < frames.length; i++) {
      const frameName = `frame-${String(i).padStart(6, '0')}.${ext}`
      const framePath = path.join(tmpDir, frameName)

      await fs.writeFile(framePath, Buffer.from(frames[i].data, 'base64'))

      // Duration = time until the NEXT frame (or 100 ms for the last frame).
      const nextTs = frames[i + 1]?.timestamp ?? frames[i].timestamp + 100
      const durationSecs = Math.max((nextTs - frames[i].timestamp) / 1000, 0.01)

      manifestLines.push(`file '${framePath}'`)
      manifestLines.push(`duration ${durationSecs.toFixed(6)}`)
    }

    // ffconcat requires the last file entry to be listed a second time without
    // a duration so the muxer knows where the last frame ends.
    const lastFramePath = path.join(
      tmpDir,
      `frame-${String(frames.length - 1).padStart(6, '0')}.${ext}`
    )
    manifestLines.push(`file '${lastFramePath}'`)

    const manifestPath = path.join(tmpDir, 'manifest.txt')
    await fs.writeFile(manifestPath, manifestLines.join('\n'))

    // ── Step 2: encode with ffmpeg ─────────────────────────────────────────
    log.info(`VideoEncoder: encoding ${frames.length} frames → ${outputPath}`)

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(manifestPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        // VP8 (libvpx) produces broadly compatible WebM that plays in Chrome,
        // Firefox, VS Code's built-in media player, and most video players.
        // VP9 CRF mode has widespread issues with incorrect color-space metadata
        // (bt470bg instead of bt709) and missing stream PTS that cause players to
        // report "invalid file" even when the container is well-formed.
        .videoCodec('libvpx')
        .outputOptions([
          // 1 Mbit/s target — good quality at reasonable file size for screencasts
          '-b:v',
          '1M',
          // Standard chroma subsampling required for VP8
          '-pix_fmt',
          'yuv420p',
          // Preserve the variable frame rate from the concat manifest timestamps.
          // Without this ffmpeg re-timestamps frames to a fixed rate and the
          // per-frame durations written in the manifest are ignored.
          '-vsync',
          'vfr',
          // Disable alt-ref frames — required for WebM muxer compatibility
          '-auto-alt-ref',
          '0',
          // Mark the video stream as the default track so Chrome/VS Code
          // select it automatically without needing an explicit track selection
          '-disposition:v',
          'default'
        ])
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err: Error) => {
          const msg = err.message || ''
          if (
            msg.includes('Cannot find ffmpeg') ||
            msg.includes('ENOENT') ||
            msg.includes('spawn') ||
            msg.includes('not found')
          ) {
            reject(
              new Error(
                'VideoEncoder: ffmpeg binary not found on PATH. ' +
                  'Install ffmpeg: https://ffmpeg.org/download.html'
              )
            )
          } else {
            reject(new Error(`VideoEncoder: ffmpeg error — ${msg}`))
          }
        })
        .run()
    })

    log.info(`✓ Screencast video saved: ${outputPath}`)
  } finally {
    // Always clean up temp files, even if encoding failed.
    await fs.rm(tmpDir, { recursive: true, force: true }).catch((rmErr) => {
      log.warn(`VideoEncoder: failed to clean temp dir — ${rmErr.message}`)
    })
  }
}
