// VP8/WebM encoder for screencast frames.

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'

import logger from '@wdio/logger'

import type { ScreencastFrame, ScreencastOptions } from '../types.js'

const require = createRequire(import.meta.url)
const log = logger('@wdio/selenium-devtools:VideoEncoder')

export async function encodeToVideo(
  frames: ScreencastFrame[],
  outputPath: string,
  options: Pick<ScreencastOptions, 'captureFormat'> = {}
): Promise<void> {
  if (frames.length === 0) {
    throw new Error('VideoEncoder: no frames to encode')
  }

  const span = frames[frames.length - 1].timestamp - frames[0].timestamp
  const totalBytes = frames.reduce(
    (sum, f) => sum + Math.floor((f.data?.length ?? 0) * 0.75),
    0
  )
  log.info(
    `🎬 Encoding ${frames.length} frame(s), captured over ${(span / 1000).toFixed(1)}s ` +
      `(~${(totalBytes / 1024 / 1024).toFixed(1)} MB raw)`
  )

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
    path.join(os.tmpdir(), 'selenium-devtools-screencast-')
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

    const lastFramePath = path.join(
      tmpDir,
      `frame-${String(frames.length - 1).padStart(6, '0')}.${ext}`
    )
    manifestLines.push(`file '${lastFramePath}'`)

    const manifestPath = path.join(tmpDir, 'manifest.txt')
    await fs.writeFile(manifestPath, manifestLines.join('\n'))

    log.info(`encoding ${frames.length} frames → ${outputPath}`)

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
          // CFR @ 10fps — VFR WebMs don't write Cues reliably, so the
          // dashboard's <video> can't read duration/seek.
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

    log.info(`✓ video saved: ${outputPath}`)
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch((rmErr) => {
      log.warn(`failed to clean temp dir — ${rmErr.message}`)
    })
  }
}
