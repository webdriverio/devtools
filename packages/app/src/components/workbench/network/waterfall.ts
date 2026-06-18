import type { NetworkRequest } from '@wdio/devtools-shared'

/** The longest request duration in a set — bars are scaled against it so the
 *  slowest request fills the track and the rest are proportional. */
export interface WaterfallScale {
  maxDuration: number
}

function durationOf(request: NetworkRequest): number {
  if (typeof request.time === 'number' && Number.isFinite(request.time)) {
    return Math.max(0, request.time)
  }
  if (typeof request.endTime === 'number') {
    return Math.max(0, request.endTime - request.startTime)
  }
  return 0
}

export function networkWindow(requests: NetworkRequest[]): WaterfallScale {
  let maxDuration = 0
  for (const request of requests) {
    const duration = durationOf(request)
    if (duration > maxDuration) {
      maxDuration = duration
    }
  }
  return { maxDuration }
}

/** Bar width as a percentage of the track, proportional to the slowest request
 *  (like the mock — every bar starts at the left). Width is 0 for untimed
 *  requests; the row renders an empty track + dash for those. A timed request
 *  gets at least 2% so the slowest request is always visibly the longest. */
export function waterfallBar(
  request: NetworkRequest,
  scale: WaterfallScale
): { offset: number; width: number } {
  const duration = durationOf(request)
  if (scale.maxDuration <= 0 || duration <= 0) {
    return { offset: 0, width: 0 }
  }
  return {
    offset: 0,
    width: clamp((duration / scale.maxDuration) * 100, 2, 100)
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
