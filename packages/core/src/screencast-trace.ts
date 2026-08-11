/**
 * Dense screencast filmstrip for trace mode. Turns the recorder's continuous
 * frame buffer into `screencast-frame` events plus content-addressed image
 * resources, so the trace player scrubs smooth playback instead of one frame
 * per action.
 *
 * Two independent bounds keep the cost in check: thinning caps the number of
 * emitted events (min inter-frame gap + drop consecutive byte-identical frames
 * + even downsample to a hard cap), and content-addressing dedupes the image
 * bytes (identical frames — a static wait polled repeatedly — collapse to one
 * resource). Framework-agnostic: adapters feed `recorder.frames`; the recorder
 * itself (CDP push on Chrome, screenshot polling elsewhere) lives per-adapter.
 */

import { createHash } from 'node:crypto'
import type { ScreencastFrame } from '@wdio/devtools-shared'
import type { TraceZipResource } from './trace-zip-writer.js'
import type { ScreencastFrameEvent } from './trace-snapshots.js'

export interface DenseScreencastOptions {
  /** Hard cap on emitted frame events (default 600). */
  maxFrames?: number
  /** Minimum ms between kept frames (default 100 ≈ 10 fps). */
  minFrameIntervalMs?: number
}

const DEFAULT_MAX_FRAMES = 600
const DEFAULT_MIN_INTERVAL_MS = 100

/**
 * Thin a continuous frame buffer down to a bounded event set. Keeps a frame
 * only when it is at least `minFrameIntervalMs` after the last kept frame and
 * its bytes differ from the last kept frame (a static run collapses to its
 * first frame — the player holds it until the next change, which is the big win
 * for polling mode where every poll re-shoots an unchanged page). A final even
 * downsample enforces the hard cap while always keeping the first and last
 * frames so the timeline still spans the full run.
 */
export function thinScreencastFrames(
  frames: readonly ScreencastFrame[],
  options: DenseScreencastOptions = {}
): ScreencastFrame[] {
  const minInterval = options.minFrameIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
  const maxFrames = options.maxFrames ?? DEFAULT_MAX_FRAMES

  const kept: ScreencastFrame[] = []
  let lastKeptTs = -Infinity
  let lastData: string | undefined
  for (const frame of frames) {
    if (frame.timestamp - lastKeptTs < minInterval) {
      continue
    }
    if (frame.data === lastData) {
      continue
    }
    kept.push(frame)
    lastKeptTs = frame.timestamp
    lastData = frame.data
  }

  if (kept.length <= maxFrames) {
    return kept
  }
  if (maxFrames <= 1) {
    return kept.length ? [kept[0]!] : []
  }
  const out: ScreencastFrame[] = []
  const step = (kept.length - 1) / (maxFrames - 1)
  for (let i = 0; i < maxFrames; i++) {
    out.push(kept[Math.round(i * step)]!)
  }
  return out
}

/**
 * Build the dense filmstrip: `screencast-frame` events (offsets rebased against
 * `wallTime`, matching the sparse filmstrip) and their image resources named by
 * content hash so byte-identical frames share a single resource. Adapters that
 * don't record frames pass an empty array and get an empty result — byte-stable
 * with today's output.
 */
export function buildDenseScreencast(
  frames: readonly ScreencastFrame[],
  pageId: string,
  wallTime: number,
  viewport: { width: number; height: number },
  options: DenseScreencastOptions = {}
): { events: ScreencastFrameEvent[]; resources: TraceZipResource[] } {
  const events: ScreencastFrameEvent[] = []
  const resources: TraceZipResource[] = []
  const seen = new Set<string>()
  for (const frame of thinScreencastFrames(frames, options)) {
    const data = Buffer.from(frame.data, 'base64')
    const sha1 = createHash('sha1').update(data).digest('hex')
    const resourceName = `${sha1}.jpeg`
    if (!seen.has(sha1)) {
      seen.add(sha1)
      resources.push({ resourceName, data })
    }
    events.push({
      type: 'screencast-frame',
      pageId,
      sha1: resourceName,
      width: viewport.width,
      height: viewport.height,
      timestamp: Math.max(0, frame.timestamp - wallTime)
    })
  }
  return { events, resources }
}
