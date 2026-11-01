// HTTP contract for the trace player (`pnpm show-trace trace.zip`). The backend
// runs in trace-serve mode and exposes the reconstructed trace at TRACE_API.get;
// the app fetches it on boot to enter player mode. Given several zips, it lists
// them at TRACE_API.run instead and serves each one's bytes for the app to read.

import type { TraceLog } from './types.js'

/** Endpoint the backend serves the reconstructed trace from in player mode. */
export const TRACE_API = {
  get: '/api/trace',
  /** The zips `show-trace` was given, when it was given more than one; 204 otherwise. */
  run: '/api/trace/run',
  /** One listed zip's bytes, by its position in the listing. */
  zip: '/api/trace/zip/:index'
} as const

/** Where one listed zip's bytes are served. */
export function traceZipUrl(index: number): string {
  return TRACE_API.zip.replace(':index', String(index))
}

/** One zip in a served run: the path it was found at, and where to fetch it. */
export interface TraceRunListingEntry {
  /** Relative to the directory `show-trace` ran in, or absolute outside it. */
  path: string
  url: string
}

/** Payload served at `TRACE_API.run`, in the order the zips were found. */
export interface TraceRunListing {
  traces: TraceRunListingEntry[]
}

/** A single screenshot frame reconstructed from a trace.zip's
 *  `screencast-frame` events + their `resources/` images. */
export interface TracePlayerFrame {
  /** Absolute wall-clock ms when the frame was captured. */
  timestamp: number
  /** Base64-encoded PNG or JPEG (no `data:` prefix), matching `CommandLog.screenshot`. */
  screenshot: string
}

/** A structural step reconstructed from a trace.zip — a runner hook, step
 *  wrapper, or tracing group marker — rendered as a collapsible tree row. */
export interface TraceActionGroupNode {
  callId: string
  title: string
  /** Absolute wall-clock ms when the step opened. */
  startTime: number
  /** Absolute wall-clock ms when the step closed. */
  endTime: number
  /** Set when the step's own after errored or any descendant failed. */
  failed?: boolean
  children: TraceActionChild[]
}

/** A command row in the tree: an index into `trace.commands`, with the rows its execution issued (a wait's reads)
 *  when it issued any. */
export interface TraceActionCommandNode {
  commandIndex: number
  children?: TraceActionChild[]
}

/** One tree slot: a nested group or a command. */
export type TraceActionChild =
  { group: TraceActionGroupNode } | TraceActionCommandNode

/** Payload served at `TRACE_API.get`. Carries the reconstructed TraceLog plus
 *  the frame filmstrip and clock window the player's timeline needs. */
export interface TracePlayerData {
  trace: TraceLog
  frames: TracePlayerFrame[]
  /** Absolute ms of the first captured event — the timeline clock origin. */
  startTime: number
  /** Total span in ms from the first event to the last. */
  duration: number
  /** Root children of the action tree, chronological. Absent when the zip
   *  carried no structural steps — the player then renders the flat list. */
  groups?: TraceActionChild[]
  /** Markdown run transcript (`transcript.md`), when the zip carried one. */
  transcript?: string
}
