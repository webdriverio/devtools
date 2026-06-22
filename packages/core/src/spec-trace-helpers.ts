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

/** Index ranges into a SessionCapturer's flat arrays for a single spec file. */
export interface SpecRange {
  specFile: string
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

// ─── Spec boundary recording ──────────────────────────────────────────────────

/**
 * Minimal context needed by `recordSpecBoundary` to detect spec-file
 * transitions and capture array index ranges.
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

/**
 * Record a spec-file boundary. When `traceGranularity` is `'spec'` and the
 * spec file has changed, this pushes a new `SpecRange` and returns the
 * previous range so the caller can flush its trace artifact.
 *
 * Returns `null` when no flush is needed (same spec, or granularity isn't
 * `'spec'`, or no capturer).
 */
export function recordSpecBoundary(
  ctx: SpecBoundaryContext,
  specFile: string,
  traceGranularity: TraceGranularity | undefined
): SpecRange | null {
  if (traceGranularity !== 'spec') {
    return null
  }
  const lastRange = ctx.specRanges[ctx.specRanges.length - 1]
  if (lastRange && lastRange.specFile === specFile) {
    return null
  }

  const prevRange =
    lastRange && !ctx.flushedSpecs.has(lastRange.specFile) ? lastRange : null

  ctx.specRanges.push({
    specFile,
    commandStartIdx: ctx.capturer.commandsLog.length,
    consoleStartIdx: ctx.capturer.consoleLogs.length,
    networkStartIdx: ctx.capturer.networkRequests.length,
    mutationStartIdx: ctx.capturer.mutations.length,
    traceLogStartIdx: ctx.capturer.traceLogs.length,
    snapshotCount: ctx.actionSnapshots.length
  })

  return prevRange
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

/**
 * Write a standalone trace artifact (zip or ndjson-directory) for a single
 * spec file. This is the shared I/O path — all three adapters delegate to it
 * from their own `flushSpecTrace` wrappers.
 */
export async function writeSpecTrace(
  input: WriteSpecTraceInput
): Promise<string> {
  const specCapturer = buildSpecCapturer(
    input.capturer,
    input.range,
    input.nextRange
  )

  const specSnapshots = input.actionSnapshots.slice(
    input.range.snapshotCount,
    input.nextRange?.snapshotCount ?? input.actionSnapshots.length
  )

  const specSessionId = buildSpecSessionId(
    input.range.specFile,
    input.sessionId
  )

  const testMetadata = filterTestMetadataBySpec(
    input.testMetadata,
    input.range.specFile
  )

  return writeTraceZip(specCapturer, {
    outputDir: input.outputDir,
    sessionId: specSessionId,
    capabilities: input.capabilities,
    actionSnapshots: specSnapshots.length > 0 ? specSnapshots : undefined,
    format: input.format,
    testMetadata
  })
}
