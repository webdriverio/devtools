// HTTP contract for the trace player (`pnpm show-trace trace.zip`). The backend
// runs in trace-serve mode, lists the zips it was given at TRACE_API.run and
// serves each one's bytes; the app probes the listing on boot to enter player
// mode and reads every zip itself. TRACE_API.get carries a whole payload, for
// `start({ trace })` and for older backends.

import type { ImageSize } from './image.js'
import type { PageResourceKind } from './page-resources.js'
import type { TraceLog } from './types.js'

/** Endpoints the backend serves in trace-serve mode. */
export const TRACE_API = {
  /** A reconstructed `TracePlayerData`, served by `start({ trace })` and by backends from before the app read zips itself; 204 otherwise. */
  get: '/api/trace',
  /** The zips `show-trace` was given, one or more; 204 in live mode. */
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
 *  `screencast-frame` events; its image stays in the zip until shown. */
export interface TracePlayerFrame {
  /** Absolute wall-clock ms when the frame was captured. */
  timestamp: number
  /** The zip entry holding the PNG or JPEG. */
  entry: string
}

/** A stylesheet or font the zip stores, read from its entry when the trace is shown. */
export interface PageResourceRef {
  url: string
  kind: PageResourceKind
  mimeType: string
  entry: string
  /** Body length in bytes. */
  size: number
}

/** The frame that shows a command's state: the latest capture at or before it,
 *  since a capture is stamped when the document was read. Falling back to the
 *  next later frame only when nothing precedes keeps a row without a capture of
 *  its own from replaying the state its SUCCESSOR produced, which is what an
 *  absolute-nearest rule does when the successor's frame is the closer one. */
export function nearestFrame<T extends { timestamp: number }>(
  frames: readonly T[],
  timestamp: number
): T | undefined {
  let preceding: T | undefined
  let following: T | undefined
  for (const frame of frames) {
    if (frame.timestamp <= timestamp) {
      if (!preceding || frame.timestamp > preceding.timestamp) {
        preceding = frame
      }
    } else if (!following || frame.timestamp < following.timestamp) {
      following = frame
    }
  }
  return preceding ?? following
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

/** What the reader builds from a trace.zip: the reconstructed TraceLog plus the
 *  frame filmstrip and clock window the player's timeline needs. Images, stored
 *  bodies and page resources are named by entry and read from the zip on demand. */
export interface TracePlayerData {
  trace: TraceLog
  frames: TracePlayerFrame[]
  /** The first frame's pixel size, so the filmstrip is shaped before any image is read. */
  frameSize?: ImageSize
  /** The largest frame's length in bytes, which bounds how many frames the filmstrip holds at once. */
  frameBytes?: number
  /** Request id to the entry holding its response body, for a body stored beside the HAR rather than in it. */
  responseBodies?: Record<string, string>
  /** The stylesheets and fonts the zip stores, absent when it stores none. */
  pageResources?: PageResourceRef[]
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

/** The whole payload served at `TRACE_API.get` (`start({ trace })`, and backends from before the app read zips itself): each frame carries its image inline, base64. */
export type LegacyTracePlayerData = Omit<TracePlayerData, 'frames'> & {
  frames: { timestamp: number; screenshot?: string }[]
}

/** The hosted player's query parameter naming a trace zip to download and open. */
export const TRACE_URL_PARAM = 'trace'

/** A position inside an opened trace, carried in the page's hash so it survives a copied address. */
export interface TraceLink {
  /** The action's `callId` in the zip (`call@12` from this writer); stable for the life of the zip. */
  action?: string
  /** A bottom-dock tab, by its label in lower case (`network`, `console`, `errors`). */
  tab?: string
}

const TRACE_LINK_KEYS = [
  'action',
  'tab'
] as const satisfies readonly (keyof TraceLink)[]

// Both are only ever compared against the trace's own ids and tab labels, never rendered or fetched.
const TRACE_LINK_VALUE: Record<keyof TraceLink, RegExp> = {
  // eslint-disable-next-line no-control-regex -- a callId is any writer's string; only control characters are refused
  action: /^[^\u0000-\u001f\u007f]{1,200}$/,
  tab: /^[a-z0-9-]{1,32}$/
}

/** Whether `parseTraceLink` would read `value` back under `key`. */
export function isTraceLinkValue(key: keyof TraceLink, value: string): boolean {
  return TRACE_LINK_VALUE[key].test(value)
}

/** Reads `#action=<callId>&tab=<label>`; a missing or malformed value is left out. */
export function parseTraceLink(hash: string): TraceLink {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const link: TraceLink = {}
  for (const key of TRACE_LINK_KEYS) {
    const value = params.get(key)
    if (value !== null && isTraceLinkValue(key, value)) {
      link[key] = value
    }
  }
  return link
}

/** The hash, without its `#`, that `parseTraceLink` reads back as `link`. */
export function formatTraceLink(link: TraceLink): string {
  return TRACE_LINK_KEYS.flatMap((key) => {
    const value = link[key]
    // `@` is legal in a fragment, so `call@12` stays readable in the address bar.
    return value
      ? [`${key}=${encodeURIComponent(value).replace(/%40/g, '@')}`]
      : []
  }).join('&')
}
