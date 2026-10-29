// The trace.zip entry names, shared by the writer and the reader; their event types stay separate because the reader also parses foreign zips.

/** Entry names inside a trace.zip, and the directory prefix for blobs. Also the
 *  filenames used by the unpacked `ndjson-directory` format. */
export const TRACE_ZIP_ENTRIES = {
  /** NDJSON action events. */
  trace: 'trace.trace',
  /** NDJSON HAR resource snapshots. Omitted when nothing was captured. */
  network: 'trace.network',
  /** NDJSON DOM mutation stream. Omitted when nothing was captured. */
  mutations: 'trace.mutations',
  /** Human/LLM-readable Markdown run transcript. */
  transcript: 'transcript.md',
  /** Screenshots, element snapshots and network bodies live under here. */
  resourcesDir: 'resources'
} as const

/** Stream suffixes the reader matches on. A zip may carry several streams (one
 *  per page/session), so entries are matched by suffix rather than exact name;
 *  `.stacks` is a sidecar the writer does not emit but foreign traces do. */
export const TRACE_STREAM_SUFFIXES = {
  trace: '.trace',
  network: '.network',
  mutations: '.mutations',
  stacks: '.stacks'
} as const

/** `type` discriminants of the NDJSON events in a `.trace` stream. */
export const TRACE_EVENT_TYPES = {
  before: 'before',
  after: 'after',
  frameSnapshot: 'frame-snapshot',
  /** Here only the response a frame-snapshot's screenshot override patches; captured traffic is in `.network`. */
  resourceSnapshot: 'resource-snapshot',
  screencastFrame: 'screencast-frame',
  contextOptions: 'context-options',
  console: 'console',
  stdout: 'stdout',
  stderr: 'stderr'
} as const

export type TraceEventType =
  (typeof TRACE_EVENT_TYPES)[keyof typeof TRACE_EVENT_TYPES]
