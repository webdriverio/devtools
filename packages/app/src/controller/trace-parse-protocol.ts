import type { TracePlayerData } from '@wdio/devtools-shared'

/** The step an open is on; no step can say how far through it is. */
export type TraceOpenPhase = 'reading' | 'unpacking' | 'building'

export type TraceOpenProgress = (phase: TraceOpenPhase) => void

/** What the page posts to the trace reader: the zip's bytes, transferred. */
export interface TraceParseRequest {
  bytes: ArrayBuffer
}

/** How a parse ended: the payload, or why the bytes are not a trace. */
export type TraceParseResult =
  { type: 'done'; data: TracePlayerData } | { type: 'error'; message: string }

/** What the trace reader posts back: any number of phases, then one result. */
export type TraceParseMessage =
  { type: 'phase'; phase: TraceOpenPhase } | TraceParseResult
