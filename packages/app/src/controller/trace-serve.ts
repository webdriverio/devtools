import {
  TRACE_API,
  type TracePlayerData,
  type TraceRunListing
} from '@wdio/devtools-shared'

import { sourcesFromListing, type TraceSource } from '../utils/trace-sources.js'

/** What `show-trace` serves on boot: one trace, or several zips to list. */
export type ServedTrace = { trace: TracePlayerData } | { run: TraceSource[] }

// 204 = live mode: the routes are always registered but serve nothing then.
async function served<T>(url: string): Promise<T | undefined> {
  const response = await fetch(url)
  return response.ok && response.status !== 204
    ? ((await response.json()) as T)
    : undefined
}

/** Undefined when no trace is served (the live dashboard) or nothing answers at all. */
export async function probeServedTrace(
  withRun: boolean
): Promise<ServedTrace | undefined> {
  try {
    const trace = await served<TracePlayerData>(TRACE_API.get)
    if (trace) {
      return { trace }
    }
    const listing = withRun
      ? await served<TraceRunListing>(TRACE_API.run)
      : undefined
    return listing ? { run: sourcesFromListing(listing) } : undefined
  } catch {
    return undefined
  }
}
