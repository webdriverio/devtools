/**
 * Worker↔backend contract for building a trace artifact server-side.
 *
 * An adapter that can run the trace transforms in-process never uses this —
 * the three JS adapters call them directly, which is what keeps trace mode
 * working with no backend at all. It exists for an adapter that streams but
 * cannot transform, today the Python one: it already sends every frame the
 * exporter needs, so the backend can assemble the artifact from the run it is
 * accumulating anyway.
 *
 * This travels over the WORKER socket rather than an HTTP route on purpose.
 * `outputDir` is an absolute path the backend writes to, and the worker socket
 * is the adapter's own channel — the same one that already hands over absolute
 * video paths for the video registry. An HTTP endpoint taking a path would be
 * reachable from any page the browser has open.
 */

import type { TraceFormat, TraceRetentionPolicy } from './types.js'

export const TRACE_EXPORT_SCOPE = {
  /** Worker → backend: build an artifact from the accumulated run. */
  request: 'traceExport',
  /** Backend → worker: where it landed, or why it did not. */
  result: 'traceExported'
} as const

export type TraceExportScope =
  (typeof TRACE_EXPORT_SCOPE)[keyof typeof TRACE_EXPORT_SCOPE]

/** Payload sent under {@link TRACE_EXPORT_SCOPE.request}. */
export interface TraceExportRequest {
  /** Correlates the result frame. One export may be in flight per request. */
  requestId: string
  /** Absolute directory to write into. The adapter decides where its
   *  artifacts live, exactly as it does when it exports in-process. */
  outputDir: string
  /** Names the artifact and identifies the session inside it. */
  sessionId: string
  /** `zip` (default) or an unpacked directory. */
  format?: TraceFormat
  /** Artifact base name. Defaults to `trace-<sessionId>`. */
  fileStem?: string
  /** Which runs are worth keeping. Evaluated against the run's own test
   *  outcomes, exactly as `writeSessionTrace` does for an in-process adapter —
   *  an unretained run writes nothing rather than writing and deleting. */
  tracePolicy?: TraceRetentionPolicy
  /** `session` (default) writes one archive for the run; `test` writes one per
   *  test, and `tracePolicy` is then evaluated per test rather than run-wide.
   *  `spec` is deliberately absent: this adapter's spec IS its test file, and a
   *  granularity that silently behaved like one of the other two would be worse
   *  than not offering it. */
  traceGranularity?: 'session' | 'test'
}

/** Payload sent under {@link TRACE_EXPORT_SCOPE.result}. Exactly one of
 *  `path` / `error` is set. */
export interface TraceExportResult {
  requestId: string
  /** Absolute path of the artifact written. Set for a session-granularity
   *  export; per-test exports report `paths` instead. */
  path?: string
  /** Absolute paths written at `test` granularity, one per RETAINED test.
   *  Empty when the policy declined every one. */
  paths?: string[]
  /** Why nothing was written. The adapter logs this; a failed export must not
   *  fail the user's test run. */
  error?: string
  /** Set when the run captured fine and `tracePolicy` decided against keeping
   *  it. Distinct from `error`: nothing went wrong, so an adapter reports it as
   *  the policy working rather than as a failure. */
  declinedByPolicy?: boolean
}
