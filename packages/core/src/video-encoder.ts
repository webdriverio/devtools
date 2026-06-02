// VP8/WebM encoder for screencast frames. Loads fluent-ffmpeg lazily via
// createRequire so the dep stays optional — adapters that ship screencast
// support are expected to list fluent-ffmpeg in their own dependencies.

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'

import type { ScreencastFrame, ScreencastOptions } from '@wdio/devtools-shared'

const require = createRequire(import.meta.url)

/**
 * Encode an array of CDP screencast frames into a .webm file using ffmpeg
 * (via fluent-ffmpeg) and the VP8 codec (libvpx).
 *
 * Strategy:
 *   1. Write each frame as a JPEG (or PNG) file in a temp directory.
 *   2. Write an ffconcat manifest that assigns each frame its exact display
 *      duration based on the inter-frame timestamp delta. Variable-frame-rate
 *      output reflects real timing even across long command pauses.
 *   3. Run ffmpeg with the concat demuxer → libvpx (VP8) → .webm output.
 *      Force CFR at 10fps — VFR WebMs don't write Cues reliably, so the
 *      dashboard `<video>` can't read duration/seek without it.
 *   4. Clean up the temp directory regardless of success or failure.
 *
 * @throws If no frames are provided, fluent-ffmpeg is not installed, or
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
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'devtools-screencast-')
  )

  try {
    const manifestLines: string[] = ['ffconcat version 1.0']

    for (let i = 0; i < frames.length; i++) {
      const frameName = `frame-${String(i).padStart(6, '0')}.${ext}`
      const framePath = path.join(tmpDir, frameName)
      await fs.writeFile(framePath, Buffer.from(frames[i].data, 'base64'))
      const nextTs = frames[i + 1]?.timestamp ?? frames[i].timestamp + 100
      const durationSecs = Math.max((nextTs - frames[i].timestamp) / 1000, 0.01)
      manifestLines.push(`file '${framePath}'`)
      manifestLines.push(`duration ${durationSecs.toFixed(6)}`)
    }

    // The last frame needs to appear twice in the manifest — ffconcat ignores
    // the final `duration` directive without a trailing `file` line.
    const lastFramePath = path.join(
      tmpDir,
      `frame-${String(frames.length - 1).padStart(6, '0')}.${ext}`
    )
    manifestLines.push(`file '${lastFramePath}'`)

    const manifestPath = path.join(tmpDir, 'manifest.txt')
    await fs.writeFile(manifestPath, manifestLines.join('\n'))

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(manifestPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .videoCodec('libvpx')
        .outputOptions([
          '-b:v',
          '1M',
          '-pix_fmt',
          'yuv420p',
          '-vsync',
          'cfr',
          '-r',
          '10',
          '-auto-alt-ref',
          '0',
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
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {
      /* tmp cleanup is best-effort */
    })
  }
}
