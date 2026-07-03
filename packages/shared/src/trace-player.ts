// HTTP contract for the trace player (`pnpm show-trace trace.zip`). The backend
// runs in trace-serve mode and exposes the reconstructed trace at TRACE_API.get;
// the app fetches it on boot to enter player mode.

import type { TraceLog } from './types.js'

/** Endpoint the backend serves the reconstructed trace from in player mode. */
export const TRACE_API = {
  get: '/api/trace'
} as const

/** A single screenshot frame reconstructed from a trace.zip's
 *  `screencast-frame` events + `resources/*.jpeg`. */
export interface TracePlayerFrame {
  /** Absolute wall-clock ms when the frame was captured. */
  timestamp: number
  /** Base64-encoded JPEG (no `data:` prefix), matching `CommandLog.screenshot`. */
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

/** One tree slot: a nested group or an index into `trace.commands`. */
export type TraceActionChild =
  | { group: TraceActionGroupNode }
  | { commandIndex: number }

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
}
