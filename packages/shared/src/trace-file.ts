// The trace.zip file layout — the one definition of how a trace is packaged.
//
// `core` writes these entries and `backend` reads them, and the two packages
// cannot import each other (backend depends on shared only). Before this module
// both sides carried their own copies of these strings, so a rename in the
// writer left every reader test green and the mismatch only surfaced when
// someone opened a real trace. Import from here on both sides instead.
//
// The *event interfaces* deliberately stay separate: `core`'s are strict (the
// writer always emits `pageId`, `apiName`, `params`, `title`) while the reader's
// are permissive, because it also parses traces this repo did not write — see
// `backend/src/trace-reader-types.ts`. Strict producer, lenient consumer; only
// the names below have to agree.

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
  screencastFrame: 'screencast-frame',
  contextOptions: 'context-options',
  console: 'console',
  stdout: 'stdout',
  stderr: 'stderr'
} as const

export type TraceEventType =
  (typeof TRACE_EVENT_TYPES)[keyof typeof TRACE_EVENT_TYPES]
