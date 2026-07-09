/**
 * Shared helpers for per-spec trace partitioning.
 *
 * The three adapters (service, nightwatch, selenium) all use the same
 * index-range tracking and spec-name sanitization logic. This module
 * is the single source of truth — adapters import from here.
 */

import type {
  ActionSnapshot,
  TestMetadataMap,
  TraceFormat,
  TraceGranularity
} from '@wdio/devtools-shared'
import type { TraceCapturer } from './trace-exporter.js'
import { writeTraceZip } from './trace-exporter.js'
import { deterministicUid } from './uid.js'

// ─── SpecRange ────────────────────────────────────────────────────────────────

/** Index ranges into a SessionCapturer's flat arrays for one trace slice
 *  (a spec file, or a single test under `test` granularity). */
export interface SpecRange {
  specFile: string
  /** Dedupe/identity key: spec path for spec slices; testUid for test slices,
   *  or `${testUid}-retry${n}` so each retried attempt is its own slice. */
  key: string
  /** Present only for test-granularity slices; the base (non-retry) testUid. */
  testUid?: string
  commandStartIdx: number
  consoleStartIdx: number
  networkStartIdx: number
  mutationStartIdx: number
  traceLogStartIdx: number
  snapshotCount: number
}

// ─── Spec name sanitization ───────────────────────────────────────────────────

/**
 * Sanitize a spec file path into a directory-safe identifier.
 * Strips directory, extension, and unsafe characters.
 * Falls back to `'unknown-spec'` when the result is empty.
 */
export function sanitizeSpecName(specFile: string): string {
  return (
    specFile
      .replace(/^.*[/\\]/, '')
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/^_+|_+$/g, '') || 'unknown-spec'
  )
}

// ─── Spec session ID ──────────────────────────────────────────────────────────

/**
 * Build a collision-safe spec-level session ID from a spec file path and
 * the parent session ID. Includes an 8-char base36 hash of the full spec
 * path so two specs with the same basename in different directories don't
 * collide.
 */
export function buildSpecSessionId(
  specFile: string,
  sessionId: string
): string {
  const base = sanitizeSpecName(specFile)
  const hash = deterministicUid(specFile).split('-').pop()!.slice(0, 8)
  return `${base}-${hash}-${sessionId.slice(0, 8)}`
}

// ─── Test slice session ID ──────────────────────────────────────────────────

/**
 * Build a collision-safe test-level session ID from the slice's spec file, its
 * identity `key` (testUid, or `${testUid}-retry${n}` for retries), and the
 * parent session ID. Hashing the key keeps retries and sibling tests in the
 * same spec from colliding on filename, while the spec basename keeps the name
 * human-readable.
 */
export function buildTestSliceSessionId(
  specFile: string,
  key: string,
  sessionId: string
): string {
  const base = sanitizeSpecName(specFile)
  const hash = deterministicUid(key).split('-').pop()!.slice(0, 8)
  return `${base}-${hash}-${sessionId.slice(0, 8)}`
}

// ─── TraceCapturer slice ─────────────────────────────────────────────────────

/**
 * Build a TraceCapturer that contains only the data for one spec file,
 * sliced from the parent capturer's flat arrays using index ranges.
 * The returned `sources` is a shallow clone so mutations to the parent's
 * source map after this call don't affect the spec-level capturer.
 */
export function buildSpecCapturer(
  capturer: TraceCapturer,
  range: SpecRange,
  nextRange?: SpecRange
): TraceCapturer {
  const end = nextRange
    ? {
        commands: nextRange.commandStartIdx,
        console: nextRange.consoleStartIdx,
        network: nextRange.networkStartIdx,
        mutations: nextRange.mutationStartIdx,
        traceLogs: nextRange.traceLogStartIdx
      }
    : undefined

  return {
    mutations: capturer.mutations.slice(range.mutationStartIdx, end?.mutations),
    traceLogs: capturer.traceLogs.slice(range.traceLogStartIdx, end?.traceLogs),
    consoleLogs: capturer.consoleLogs.slice(
      range.consoleStartIdx,
      end?.console
    ),
    networkRequests: capturer.networkRequests.slice(
      range.networkStartIdx,
      end?.network
    ),
    commandsLog: capturer.commandsLog.slice(
      range.commandStartIdx,
      end?.commands
    ),
    sources: new Map(capturer.sources),
    metadata: capturer.metadata,
    startWallTime: capturer.startWallTime
  }
}

// ─── Test metadata filtering ──────────────────────────────────────────────────

/**
 * Filter a full `testUid → metadata` map to only include entries whose
 * `specFile` matches the given value. Used when flushing a per-spec trace
 * to attach only that spec's test titles as tracingGroup names.
 */
export function filterTestMetadataBySpec(
  allMetadata: TestMetadataMap,
  specFile: string
): TestMetadataMap {
  const filtered: TestMetadataMap = new Map()
  for (const [uid, meta] of allMetadata) {
    if (meta.specFile === specFile) {
      filtered.set(uid, meta)
    }
  }
  return filtered
}

/**
 * Filter a full `testUid → metadata` map down to a single test's entry. The
 * per-test analog of {@link filterTestMetadataBySpec}: a test slice's metadata
 * is just that one test's entry, attached as its tracingGroup name.
 */
export function filterTestMetadataByUid(
  allMetadata: TestMetadataMap,
  testUid: string
): TestMetadataMap {
  const filtered: TestMetadataMap = new Map()
  const entry = allMetadata.get(testUid)
  if (entry) {
    filtered.set(testUid, entry)
  }
  return filtered
}

// ─── Spec boundary recording ──────────────────────────────────────────────────

/**
 * Minimal context needed by `recordSliceBoundary` to detect spec-file / test
 * transitions and capture array index ranges. `flushedSpecs` holds already-
 * flushed slice keys (spec paths or test keys), shared with the finalizer.
 */
export interface SpecBoundaryContext {
  specRanges: SpecRange[]
  flushedSpecs: Set<string>
  capturer: {
    commandsLog: ArrayLike<unknown>
    consoleLogs: ArrayLike<unknown>
    networkRequests: ArrayLike<unknown>
    mutations: ArrayLike<unknown>
    traceLogs: ArrayLike<unknown>
  }
  actionSnapshots: ArrayLike<unknown>
}

/** Push a new slice range and return the previous (unflushed) range to flush.
 *  `suppressSameKey` skips recording when the incoming key matches the last
 *  range's — used for spec granularity so consecutive tests in one file share
 *  a slice; test granularity records every attempt (retries included). */
function pushSliceRange(
  ctx: SpecBoundaryContext,
  specFile: string,
  key: string,
  testUid: string | undefined,
  suppressSameKey: boolean
): SpecRange | null {
  const lastRange = ctx.specRanges[ctx.specRanges.length - 1]
  if (suppressSameKey && lastRange && lastRange.key === key) {
    return null
  }
  const prevRange =
    lastRange && !ctx.flushedSpecs.has(lastRange.key) ? lastRange : null

  ctx.specRanges.push({
    specFile,
    key,
    testUid,
    commandStartIdx: ctx.capturer.commandsLog.length,
    consoleStartIdx: ctx.capturer.consoleLogs.length,
    networkStartIdx: ctx.capturer.networkRequests.length,
    mutationStartIdx: ctx.capturer.mutations.length,
    traceLogStartIdx: ctx.capturer.traceLogs.length,
    snapshotCount: ctx.actionSnapshots.length
  })

  return prevRange
}

/**
 * Record a trace-slice boundary. For `spec` granularity, a new slice starts
 * when the spec file changes (existing behavior). For `test` granularity, a
 * new slice starts on every recorded test — including retries: a repeated
 * `testUid` is keyed `${testUid}-retry${n}` so each attempt is its own slice.
 * Returns the previous, not-yet-flushed range so the caller can flush it, or
 * `null` when nothing needs flushing (same spec, missing testUid, or a
 * non-sliced granularity).
 */
export function recordSliceBoundary(
  ctx: SpecBoundaryContext,
  granularity: TraceGranularity | undefined,
  specFile: string,
  testUid?: string
): SpecRange | null {
  if (granularity === 'spec') {
    return pushSliceRange(ctx, specFile, specFile, undefined, true)
  }
  if (granularity === 'test' && testUid !== undefined) {
    const priorAttempts = ctx.specRanges.filter(
      (r) => r.testUid === testUid
    ).length
    const key =
      priorAttempts === 0 ? testUid : `${testUid}-retry${priorAttempts}`
    return pushSliceRange(ctx, specFile, key, testUid, false)
  }
  return null
}

/**
 * Record a spec-file boundary. Thin back-compat wrapper over
 * {@link recordSliceBoundary}; behavior is unchanged for `spec` granularity
 * and returns `null` for every other granularity.
 */
export function recordSpecBoundary(
  ctx: SpecBoundaryContext,
  specFile: string,
  traceGranularity: TraceGranularity | undefined
): SpecRange | null {
  return recordSliceBoundary(ctx, traceGranularity, specFile)
}

// ─── Spec trace I/O ────────────────────────────────────────────────────────────

/**
 * Pre-resolved inputs for `writeSpecTrace`. The caller gathers
 * adapter-specific state (session ID, output directory, test metadata …)
 * and passes it in; this function does the framework-agnostic slicing,
 * session-ID derivation, filtering, and disk I/O.
 */
export interface WriteSpecTraceInput {
  range: SpecRange
  nextRange?: SpecRange
  /** Shape-compatible with `buildSpecCapturer`'s first parameter. */
  capturer: Parameters<typeof buildSpecCapturer>[0]
  actionSnapshots: ActionSnapshot[]
  sessionId: string
  outputDir: string
  format?: TraceFormat
  /** Full test-metadata map (all specs); filtered to `range.specFile` internally. */
  testMetadata: TestMetadataMap
  capabilities?: unknown
}

/** Slice the parent capturer/snapshots for one range and write the artifact
 *  under `sliceSessionId` with the pre-filtered `testMetadata`. Shared by the
 *  spec and test write paths so both slice identically. */
async function writeSliceTrace(
  input: WriteSpecTraceInput,
  sliceSessionId: string,
  testMetadata: TestMetadataMap
): Promise<string> {
  const sliceCapturer = buildSpecCapturer(
    input.capturer,
    input.range,
    input.nextRange
  )

  const sliceSnapshots = input.actionSnapshots.slice(
    input.range.snapshotCount,
    input.nextRange?.snapshotCount ?? input.actionSnapshots.length
  )

  return writeTraceZip(sliceCapturer, {
    outputDir: input.outputDir,
    sessionId: sliceSessionId,
    capabilities: input.capabilities,
    actionSnapshots: sliceSnapshots.length > 0 ? sliceSnapshots : undefined,
    format: input.format,
    testMetadata
  })
}

/**
 * Write a standalone trace artifact (zip or ndjson-directory) for a single
 * spec file. This is the shared I/O path — all three adapters delegate to it
 * from their own `flushSpecTrace` wrappers.
 */
export async function writeSpecTrace(
  input: WriteSpecTraceInput
): Promise<string> {
  return writeSliceTrace(
    input,
    buildSpecSessionId(input.range.specFile, input.sessionId),
    filterTestMetadataBySpec(input.testMetadata, input.range.specFile)
  )
}

/**
 * Write a standalone trace artifact for a single test slice. Reuses
 * {@link WriteSpecTraceInput}; the slice identity comes from `range.key`
 * (retry-aware) and its metadata from the base `range.testUid`.
 */
export async function writeTestSliceTrace(
  input: WriteSpecTraceInput
): Promise<string> {
  const testUid = input.range.testUid ?? input.range.key
  return writeSliceTrace(
    input,
    buildTestSliceSessionId(
      input.range.specFile,
      input.range.key,
      input.sessionId
    ),
    filterTestMetadataByUid(input.testMetadata, testUid)
  )
}
