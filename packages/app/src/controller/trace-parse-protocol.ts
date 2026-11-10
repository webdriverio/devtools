import type { TracePlayerData } from '@wdio/devtools-shared'

/** The step an open is on; no step can say how far through it is. */
export type TraceOpenPhase =
  'downloading' | 'reading' | 'unpacking' | 'building'

export type TraceOpenProgress = (phase: TraceOpenPhase) => void

/** What the page posts to the trace reader: the zip to open, then entries of it to read. */
export type TraceReaderRequest =
  { type: 'open'; blob: Blob } | { type: 'entry'; id: number; name: string }

/** How an open ended: the payload, or why the zip is not a trace. */
export type TraceOpenResult =
  { type: 'done'; data: TracePlayerData } | { type: 'error'; message: string }

/** One entry's bytes, or why they could not be read. */
export type TraceEntryResult =
  | { type: 'entry'; id: number; blob: Blob }
  | { type: 'entry-error'; id: number; message: string }

/** What the trace reader posts back: phases then one open result, then a result per entry asked for. */
export type TraceReaderMessage =
  { type: 'phase'; phase: TraceOpenPhase } | TraceOpenResult | TraceEntryResult
