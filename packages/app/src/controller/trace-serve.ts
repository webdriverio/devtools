import {
  TRACE_API,
  type LegacyTracePlayerData,
  type TraceRunListing
} from '@wdio/devtools-shared'

import { sourcesFromListing, type TraceSource } from '../utils/trace-sources.js'

/** What the backend serves on boot: zips for the app to read, or one payload it reconstructed itself. */
export type ServedTraces =
  { run: TraceSource[] } | { payload: LegacyTracePlayerData }

// 204 = nothing served here: the routes are always registered.
async function served<T>(url: string): Promise<T | undefined> {
  const response = await fetch(url)
  return response.ok && response.status !== 204
    ? ((await response.json()) as T)
    : undefined
}

/** Undefined when nothing is served (the live dashboard) or nothing answers at all. */
export async function probeServedTraces(): Promise<ServedTraces | undefined> {
  try {
    const listing = await served<TraceRunListing>(TRACE_API.run)
    if (listing?.traces.length) {
      return { run: sourcesFromListing(listing) }
    }
    // Backends from before the app read zips serve `show-trace one.zip` here instead.
    const payload = await served<LegacyTracePlayerData>(TRACE_API.get)
    return payload ? { payload } : undefined
  } catch {
    return undefined
  }
}
