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
  writeSpecTrace,
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
 * Policy-aware single-range flush: dedupes via `ctx.flushed`, applies the
 * retention decision, and delegates the byte-level slicing/naming to
 * `writeSpecTrace`. Returns the artifact, or undefined when the range was
 * already flushed.
 */
export async function flushRangeTrace(
  ctx: TraceExportContext,
  range: SpecRange,
  nextRange?: SpecRange
): Promise<TraceArtifact | undefined> {
  if (ctx.flushed.has(range.specFile)) {
    return undefined
  }
  ctx.flushed.add(range.specFile)

  const sliceMetadata = filterTestMetadataBySpec(
    ctx.testMetadata,
    range.specFile
  )
  const artifact: TraceArtifact = {
    kind: 'trace',
    path: '',
    scope: 'spec',
    key: range.specFile,
    testUids: Array.from(sliceMetadata.keys()),
    retained: shouldRetain(ctx, sliceMetadata)
  }
  if (!artifact.retained) {
    ctx.onArtifact?.(artifact)
    return artifact
  }

  artifact.path = await writeSpecTrace({
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
    `Trace for spec "${range.specFile}" saved to ${artifact.path}`
  )
  ctx.onArtifact?.(artifact)
  return artifact
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
  for (const range of ctx.ranges) {
    const artifact = await safely(ctx, () => flushRangeTrace(ctx, range))
    if (artifact) {
      artifacts.push(artifact)
    }
  }
  return artifacts
}

/**
 * Entry point for the after/end-of-run hook. No-op outside trace mode. Awaits
 * any pending snapshot captures, then fans out to per-spec or session writes.
 * `spec` granularity with no recorded boundaries warns and falls back to a
 * single session-level trace.
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
  if (ctx.granularity === 'spec' && ctx.ranges.length > 0) {
    return flushAllRanges(ctx)
  }
  if (ctx.granularity === 'spec') {
    ctx.log?.('warn', SPEC_WITHOUT_BOUNDARIES_WARNING)
  }
  const artifact = await safely(ctx, () => writeSessionTrace(ctx))
  return artifact ? [artifact] : []
}
