/**
 * Framework-agnostic orchestration of the trace-mode export at end-of-run:
 * session vs per-spec fan-out, the spec-granularity-without-boundaries
 * fallback, retention gating, and per-write error isolation. The three
 * adapters assemble a TraceExportContext from their own state and call
 * finalizeTraceExport — all sequencing lives here.
 */

import type {
  ActionSnapshot,
  DevToolsMode,
  TestMetadataMap,
  TraceFormat,
  TraceGranularity,
  TraceRetentionPolicy
} from '@wdio/devtools-shared'
import { errorMessage } from './error.js'
import {
  filterTestMetadataBySpec,
  filterTestMetadataByUid,
  writeSpecTrace,
  writeTestSliceTrace,
  type SpecRange
} from './spec-trace-helpers.js'
import { shouldRetainTrace, type TestOutcome } from './trace-retention.js'
import { writeTraceZip, type TraceCapturer } from './trace-exporter.js'

/** One artifact produced (or, when `retained` is false, decided-against) by a
 *  trace-mode finalize pass. */
export interface TraceArtifact {
  kind: 'trace' | 'video'
  path: string
  scope: 'session' | 'spec' | 'test'
  /** specFile for spec scope, testUid for test scope. */
  key?: string
  testUids: string[]
  /** false = decided-not-to-write (reported, not written). Always true today. */
  retained: boolean
}

export interface TraceExportContext {
  mode?: DevToolsMode
  /** undefined → treated as `on` (always retain) by the retention evaluator. */
  policy?: TraceRetentionPolicy
  /** True when the adapter fed real per-test attempt numbers (B4); retry-aware
   *  policies degrade to retain-on-failure when this is false. */
  attemptInfoAvailable?: boolean
  granularity?: TraceGranularity
  format?: TraceFormat
  capturer: TraceCapturer
  actionSnapshots?: ActionSnapshot[]
  sessionId: string
  capabilities?: unknown
  testMetadata: TestMetadataMap
  /** Recorded spec boundaries; empty for session granularity. */
  ranges: SpecRange[]
  /** Spec-file dedupe set shared with the adapter's boundary flushes. */
  flushed: Set<string>
  /** Adapters keep their differing dir logic; range is set for spec writes. */
  resolveOutputDir: (range?: SpecRange) => string
  /** Service dedupes same-timestamp snapshots; others pass identity. */
  prepareSnapshots?: (snaps: ActionSnapshot[]) => ActionSnapshot[]
  /** Pending snapshot captures to settle before writing (selenium/nightwatch). */
  awaitPending?: Promise<unknown>[]
  log?: (level: 'info' | 'warn', msg: string) => void
  onArtifact?: (a: TraceArtifact) => void
}

const SPEC_WITHOUT_BOUNDARIES_WARNING =
  'traceGranularity is "spec" but no spec boundaries were detected ' +
  '(the runner may not expose per-test hooks). Falling back to ' +
  'session-level trace.'

const TEST_WITHOUT_BOUNDARIES_WARNING =
  'traceGranularity is "test" but no test boundaries were detected ' +
  '(the runner may not expose per-test hooks). Falling back to ' +
  'session-level trace.'

/** Above this many slices, warn to pair granularity with a retention policy. */
const SLICE_COUNT_WARN_THRESHOLD = 200

function sliceCountWarning(count: number): string {
  return (
    `traceGranularity produced ${count} trace slices. Consider pairing it ` +
    'with a retention policy (e.g. tracePolicy: "retain-on-failure") to ' +
    'avoid writing hundreds of trace archives.'
  )
}

/** Project a metadata slice onto the retention evaluator's outcome shape. */
function toOutcomes(metadata: TestMetadataMap): TestOutcome[] {
  return Array.from(metadata.values(), (m) => ({
    state: m.state,
    attempt: m.attempt
  }))
}

/**
 * Evaluate the retention policy for one trace slice. Adapters that feed real
 * per-test attempt numbers also set `attemptInfoAvailable`; when they don't,
 * retry-aware policies degrade to retain-on-failure (see trace-retention.ts).
 */
function shouldRetain(
  ctx: TraceExportContext,
  metadata: TestMetadataMap
): boolean {
  return shouldRetainTrace(ctx.policy, {
    outcomes: toOutcomes(metadata),
    attemptInfoAvailable: ctx.attemptInfoAvailable ?? false
  }).retain
}

/**
 * Policy-aware single-range flush: dedupes via `ctx.flushed` on the slice
 * `key`, applies the retention decision, and delegates the byte-level
 * slicing/naming to `writeSpecTrace` (spec slices) or `writeTestSliceTrace`
 * (test slices, distinguished by `range.testUid`). Returns the artifact, or
 * undefined when the range was already flushed.
 */
export async function flushRangeTrace(
  ctx: TraceExportContext,
  range: SpecRange,
  nextRange?: SpecRange
): Promise<TraceArtifact | undefined> {
  if (ctx.flushed.has(range.key)) {
    return undefined
  }
  ctx.flushed.add(range.key)

  const isTestSlice = range.testUid !== undefined
  const sliceMetadata = isTestSlice
    ? filterTestMetadataByUid(ctx.testMetadata, range.testUid!)
    : filterTestMetadataBySpec(ctx.testMetadata, range.specFile)
  const artifact: TraceArtifact = {
    kind: 'trace',
    path: '',
    scope: isTestSlice ? 'test' : 'spec',
    key: range.key,
    testUids: Array.from(sliceMetadata.keys()),
    retained: shouldRetain(ctx, sliceMetadata)
  }
  if (!artifact.retained) {
    ctx.onArtifact?.(artifact)
    return artifact
  }

  const writeSlice = isTestSlice ? writeTestSliceTrace : writeSpecTrace
  artifact.path = await writeSlice({
    range,
    nextRange,
    capturer: ctx.capturer,
    actionSnapshots: ctx.actionSnapshots ?? [],
    sessionId: ctx.sessionId,
    outputDir: ctx.resolveOutputDir(range),
    format: ctx.format,
    testMetadata: ctx.testMetadata,
    capabilities: ctx.capabilities
  })
  ctx.log?.(
    'info',
    `Trace for ${isTestSlice ? 'test' : 'spec'} "${range.key}" saved to ${artifact.path}`
  )
  ctx.onArtifact?.(artifact)
  return artifact
}

/**
 * Flush one slice via {@link flushRangeTrace}, logging the shared spec/test
 * error string on failure so a failed boundary flush can't abort the next test.
 * All three adapters wrapped this identically; the label + identity are derived
 * from `range.testUid` (test slice → `test "<key>"`, else `spec "<specFile>"`),
 * so each call site keeps its exact message. Errors are logged and swallowed
 * (resolves `undefined`), so callers `await` it when the write must land before
 * a retry overwrites metadata, or fire-and-forget (`void`, or tracked in an
 * in-flight list) otherwise. Callers keep their own find-current-range strategy
 * and pass the resolved range in.
 */
export async function flushRangeLogged(
  ctx: TraceExportContext,
  range: SpecRange
): Promise<TraceArtifact | undefined> {
  try {
    return await flushRangeTrace(ctx, range)
  } catch (err) {
    const label =
      range.testUid !== undefined
        ? `test "${range.key}"`
        : `spec "${range.specFile}"`
    ctx.log?.(
      'warn',
      `Failed to flush trace for ${label}: ${errorMessage(err)}`
    )
    return undefined
  }
}

async function writeSessionTrace(
  ctx: TraceExportContext
): Promise<TraceArtifact | undefined> {
  const prepare = ctx.prepareSnapshots ?? ((s) => s)
  const snapshots = prepare(ctx.actionSnapshots ?? [])
  const artifact: TraceArtifact = {
    kind: 'trace',
    path: '',
    scope: 'session',
    testUids: Array.from(ctx.testMetadata.keys()),
    retained: shouldRetain(ctx, ctx.testMetadata)
  }
  if (!artifact.retained) {
    ctx.onArtifact?.(artifact)
    return artifact
  }

  artifact.path = await writeTraceZip(ctx.capturer, {
    outputDir: ctx.resolveOutputDir(),
    sessionId: ctx.sessionId,
    capabilities: ctx.capabilities,
    actionSnapshots: snapshots.length ? snapshots : undefined,
    format: ctx.format,
    testMetadata: ctx.testMetadata
  })
  ctx.log?.('info', `Trace saved to ${artifact.path}`)
  ctx.onArtifact?.(artifact)
  return artifact
}

/** Run one write, logging and swallowing its error so siblings still write. */
async function safely(
  ctx: TraceExportContext,
  write: () => Promise<TraceArtifact | undefined>
): Promise<TraceArtifact | undefined> {
  try {
    return await write()
  } catch (err) {
    ctx.log?.('warn', `trace write failed: ${errorMessage(err)}`)
    return undefined
  }
}

async function flushAllRanges(
  ctx: TraceExportContext
): Promise<TraceArtifact[]> {
  const artifacts: TraceArtifact[] = []
  // Bound each slice by the next range's start indices; the final range (no
  // nextRange) runs to the end of the arrays. Without this, every slice would
  // run to the end and each test slice would swallow all later tests.
  for (let i = 0; i < ctx.ranges.length; i++) {
    const range = ctx.ranges[i]!
    const nextRange = ctx.ranges[i + 1]
    const artifact = await safely(ctx, () =>
      flushRangeTrace(ctx, range, nextRange)
    )
    if (artifact) {
      artifacts.push(artifact)
    }
  }
  return artifacts
}

/**
 * Entry point for the after/end-of-run hook. No-op outside trace mode. Awaits
 * any pending snapshot captures, then fans out to per-spec, per-test, or
 * session writes. `spec`/`test` granularity with no recorded boundaries warns
 * and falls back to a single session-level trace.
 */
export async function finalizeTraceExport(
  ctx: TraceExportContext
): Promise<TraceArtifact[]> {
  if (ctx.mode !== 'trace') {
    return []
  }
  if (ctx.awaitPending?.length) {
    await Promise.allSettled(ctx.awaitPending)
  }
  const sliced = ctx.granularity === 'spec' || ctx.granularity === 'test'
  if (sliced && ctx.ranges.length > 0) {
    if (ctx.ranges.length > SLICE_COUNT_WARN_THRESHOLD) {
      ctx.log?.('warn', sliceCountWarning(ctx.ranges.length))
    }
    return flushAllRanges(ctx)
  }
  if (ctx.granularity === 'spec') {
    ctx.log?.('warn', SPEC_WITHOUT_BOUNDARIES_WARNING)
  } else if (ctx.granularity === 'test') {
    ctx.log?.('warn', TEST_WITHOUT_BOUNDARIES_WARNING)
  }
  const artifact = await safely(ctx, () => writeSessionTrace(ctx))
  return artifact ? [artifact] : []
}
