/**
 * Trace-slice boundary recording for `spec` and `test` granularity.
 *
 * `spec` slices are recorded/flushed at each spec-file transition (unchanged
 * from the original inline `beforeEach` logic). For `test`, Nightwatch builds
 * test outcomes into the suite tree in place — a retry overwrites the previous
 * attempt's state (regular tests reuse the same test object; cucumber replaces
 * the scenario suite). So each attempt's slice is flushed at its own
 * test/scenario END, before the next attempt can overwrite the outcome the
 * flush reads. Regular tests drive this from test-lifecycle, cucumber scenarios
 * from cucumber-lifecycle; both share this module.
 */

import {
  findFlushableRange,
  recordSliceBoundary,
  recordSpecBoundary,
  type SpecBoundaryContext,
  type SpecRange,
  type TraceArtifact
} from '@wdio/devtools-core'
import type { SessionCapturer } from './session.js'
import type { TraceGranularity } from './types.js'

export interface TestSliceCtx {
  readonly sessionCapturer: SessionCapturer
  readonly traceMode: boolean
  readonly traceGranularity: TraceGranularity
  readonly specRanges: SpecRange[]
  readonly flushedSpecs: Set<string>
  flushTraceRange(range: SpecRange): Promise<TraceArtifact | undefined>
}

function sliceActive(ctx: TestSliceCtx): boolean {
  return ctx.traceMode && ctx.traceGranularity === 'test'
}

function boundaryContext(ctx: TestSliceCtx): SpecBoundaryContext {
  return {
    specRanges: ctx.specRanges,
    flushedSpecs: ctx.flushedSpecs,
    capturer: ctx.sessionCapturer
  }
}

function flushPrevious(ctx: TestSliceCtx, prevRange: SpecRange | null): void {
  if (!prevRange) {
    return
  }
  // flushTraceRange (→ core flushRangeLogged) logs+swallows on failure.
  void ctx.flushTraceRange(prevRange)
}

/**
 * Record a spec-file boundary at test/scenario start and eagerly flush the
 * previous spec's slice. No-op for `session`/`test` granularity (core returns
 * null). Preserves the original `beforeEach` behavior verbatim.
 */
export function recordSpecSliceBoundary(
  ctx: TestSliceCtx,
  specFile: string
): void {
  const prevRange = recordSpecBoundary(
    boundaryContext(ctx),
    specFile,
    ctx.traceGranularity
  )
  flushPrevious(ctx, prevRange)
}

/**
 * Record a per-test slice boundary at test/scenario start. No-op outside trace
 * mode + `test` granularity. Retries push a distinct range (core keys a repeat
 * `${testUid}-retry${n}`), so each attempt becomes its own artifact.
 */
export function recordTestSliceBoundary(
  ctx: TestSliceCtx,
  specFile: string,
  testUid: string
): void {
  if (!sliceActive(ctx)) {
    return
  }
  recordSliceBoundary(boundaryContext(ctx), 'test', specFile, testUid)
}

/**
 * Flush the current test's slice at test/scenario end — before a retry can
 * overwrite its outcome in the suite tree. Fire-and-forget; the finalize pass
 * is the safety net for any range this misses. No-op outside trace + `test`.
 */
export function flushTestSlice(ctx: TestSliceCtx): void {
  if (!sliceActive(ctx)) {
    return
  }
  const range = findFlushableRange(ctx.specRanges)
  if (!range) {
    return
  }
  // flushTraceRange (→ core flushRangeLogged) logs+swallows on failure.
  void ctx.flushTraceRange(range)
}
