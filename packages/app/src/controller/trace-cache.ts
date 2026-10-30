import type { TraceLog } from '@wdio/devtools-shared'

import { CACHE_ID } from './constants.js'

/** Keeps the last trace a live socket delivered, for a reload while the backend is down. */
export function cacheTrace(trace: TraceLog): void {
  try {
    localStorage.setItem(CACHE_ID, JSON.stringify(trace))
  } catch (err) {
    console.warn(
      'Trace too large to cache in localStorage; skipping cache.',
      err
    )
  }
}

export function readCachedTrace(): TraceLog | undefined {
  try {
    const cached: unknown = JSON.parse(localStorage.getItem(CACHE_ID) || '')
    return typeof cached === 'object' && cached !== null
      ? (cached as TraceLog)
      : undefined
  } catch (e: unknown) {
    console.warn(`Failed to parse cached trace file: ${(e as Error).message}`)
    return undefined
  }
}
