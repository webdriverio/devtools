/**
 * Builds a trace artifact from the run the backend is already accumulating.
 *
 * The transforms are `@wdio/devtools-trace`, the same code the JS adapters run
 * in-process — the point of the split is that there is one implementation, not
 * one per language. This module is only the adapter between the accumulator's
 * shape and the exporter's, plus the two derivations the wire does not carry.
 */

import logger from '@wdio/logger'
import type {
  ActionSnapshot,
  NativePlatform,
  TestMetadataMap,
  TraceExportRequest,
  TraceRetentionPolicy
} from '@wdio/devtools-shared'
import { serializeWebSnapshot } from '@wdio/devtools-trace/a11y-snapshot'
import {
  nativeSnapshotFromPageSource,
  type NativeSnapshot
} from '@wdio/devtools-trace/native-snapshot'
import {
  writeTraceZip,
  type TraceCapturer
} from '@wdio/devtools-trace/trace-exporter'
import {
  shouldRetainTrace,
  type RetentionDecision
} from '@wdio/devtools-trace/trace-retention'
import type { ActiveRun, TimeWindowNode } from './baseline/types.js'
import { sliceRunByTest } from './trace-slice.js'

const log = logger('@wdio/devtools-backend')

/**
 * Test titles for `Tracing.tracingGroup` events, derived from the suite tree
 * the backend builds for Preserve & Rerun. `specFile` is required by the entry
 * shape but genuinely unknown for a node that reported no file, and an empty
 * string is what the exporter already tolerates from adapters that omit it.
 */
export function testMetadataFromNodes(
  nodes: Map<string, TimeWindowNode>
): TestMetadataMap {
  const metadata: TestMetadataMap = new Map()
  for (const node of nodes.values()) {
    if (node.kind !== 'test') {
      continue
    }
    metadata.set(node.uid, {
      title: node.title ?? node.fullTitle ?? node.uid,
      specFile: node.file ?? '',
      ...(node.state ? { state: node.state } : {})
    })
  }
  return metadata
}

// A raw page tree becomes the A11y text (and, for a native page source, the element list) here, for an adapter that cannot run these TypeScript transforms.
function serializeTrees(snapshots: ActionSnapshot[]): ActionSnapshot[] {
  const parsed = new Map<string, NativeSnapshot | undefined>()
  return snapshots.map((snap) => {
    const { pageSource, platform, ...rest } = snap
    try {
      return pageSource === undefined
        ? fromA11yTree(snap)
        : fromPageSource(rest, pageSource, platform, parsed)
    } catch (err) {
      // One unparseable tree costs that action its A11y pane, not the run its archive.
      log.warn(
        `could not serialize the page tree of the action at ${snap.timestamp}: ${err instanceof Error ? err.message : String(err)}`
      )
      return rest
    }
  })
}

function fromA11yTree(snap: ActionSnapshot): ActionSnapshot {
  if (snap.snapshotText || !snap.accessibilityTree?.length) {
    return snap
  }
  const { accessibilityTree, ...rest } = snap
  return {
    ...rest,
    snapshotText: serializeWebSnapshot(accessibilityTree, {
      url: snap.url,
      title: snap.title
    })
  }
}

function fromPageSource(
  snap: ActionSnapshot,
  pageSource: string,
  platform: NativePlatform | undefined,
  parsed: Map<string, NativeSnapshot | undefined>
): ActionSnapshot {
  const native = snap.snapshotText
    ? undefined
    : parseOnce(pageSource, platform, parsed)
  if (!native) {
    return snap
  }
  return {
    ...snap,
    snapshotText: native.snapshotText,
    elements: snap.elements?.length ? snap.elements : native.elements
  }
}

// Consecutive captures of an unchanged screen, the end-of-test frame above all, send the same source.
function parseOnce(
  pageSource: string,
  platform: NativePlatform | undefined,
  parsed: Map<string, NativeSnapshot | undefined>
): NativeSnapshot | undefined {
  const key = `${platform ?? ''}\n${pageSource}`
  if (!parsed.has(key)) {
    parsed.set(key, nativeSnapshotFromPageSource(pageSource, platform))
  }
  return parsed.get(key)
}

/**
 * Adapt the accumulator to the exporter's input. Only `sources` needs
 * reshaping — the accumulator stores the canonical shared types for
 * everything else, so nothing here is a cast.
 */
function toCapturer(run: Readonly<ActiveRun>): TraceCapturer {
  return {
    mutations: run.mutations,
    traceLogs: run.traceLogs,
    consoleLogs: run.consoleLogs,
    networkRequests: run.networkRequests,
    commandsLog: run.commands,
    sources: new Map(Object.entries(run.sources)),
    metadata: run.metadata,
    startWallTime: run.startedAt,
    pageResources: run.pageResources,
    resourceReReads: run.resourceReReads
  }
}

/** Nothing worth writing. An empty artifact is worse than a clear decline —
 *  it reads in the viewer as a run that captured nothing. */
export function hasExportableData(run: Readonly<ActiveRun>): boolean {
  return (
    run.commands.length > 0 ||
    run.consoleLogs.length > 0 ||
    run.networkRequests.length > 0
  )
}

/**
 * Whether this run is worth an archive, by the same rule and the same function
 * `core/trace-finalizer.ts` `writeSessionTrace` applies for an in-process
 * adapter — one implementation, not one per language.
 *
 * `attemptInfoAvailable` is false because nothing on the wire carries an
 * attempt number: the accumulator's node tree keeps one state per uid, so a
 * retried test overwrites its own earlier outcome. The retry-aware policies
 * therefore degrade to `retain-on-failure`, which `shouldRetainTrace` reports
 * through `degradedToFailure` rather than silently.
 */
export function retentionDecision(
  run: Readonly<ActiveRun>,
  policy: TraceRetentionPolicy | undefined
): RetentionDecision {
  const outcomes = Array.from(run.nodes.values())
    .filter((node) => node.kind === 'test')
    .map((node) => ({ state: node.state }))
  return shouldRetainTrace(policy, { outcomes, attemptInfoAvailable: false })
}

export async function exportActiveRunTrace(
  run: Readonly<ActiveRun>,
  request: Pick<
    TraceExportRequest,
    'outputDir' | 'sessionId' | 'format' | 'fileStem' | 'tracePolicy'
  >
): Promise<string> {
  if (!hasExportableData(run)) {
    throw new Error('nothing captured for this run')
  }
  if (!retentionDecision(run, request.tracePolicy).retain) {
    // Distinct from the error above: that one means the run captured nothing,
    // this one means it captured a run nobody asked to keep.
    throw new Error(`trace not retained by policy '${request.tracePolicy}'`)
  }
  // `capabilities` is not passed separately: writeTraceZip spreads the
  // capturer's own metadata, which already carries it.
  return writeTraceZip(toCapturer(run), {
    outputDir: request.outputDir,
    sessionId: request.sessionId,
    ...(request.format ? { format: request.format } : {}),
    ...(request.fileStem ? { fileStem: request.fileStem } : {}),
    // Absence is meaningful here too, and differently: given none, the
    // exporter synthesizes bare snapshots from commands carrying screenshots,
    // so an adapter that sends nothing still gets pictures — just no elements.
    ...(run.actionSnapshots.length
      ? { actionSnapshots: serializeTrees(run.actionSnapshots) }
      : {}),
    // Omitted when empty rather than passed as []: the exporter treats absence
    // as "no dense filmstrip" and keeps the sparse per-action one, which is
    // what an adapter that did not ask for frames should still get.
    ...(run.screencastFrames.length
      ? { screencastFrames: run.screencastFrames }
      : {}),
    testMetadata: testMetadataFromNodes(run.nodes)
  })
}

/** Filesystem-safe fragment of a test's identity, for its artifact name. */
function slugForTest(uid: string, title: string): string {
  const base = (title || uid)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  // A hash of the UID, not of the title: two tests can share a title (a
  // parametrised case), and colliding names would have one overwrite the other.
  let hash = 0
  for (let i = 0; i < uid.length; i++) {
    hash = (hash * 31 + uid.charCodeAt(i)) | 0
  }
  return `${base || 'test'}-${(hash >>> 0).toString(36).slice(0, 6)}`
}

/**
 * One archive per test that the policy retains.
 *
 * A test whose slice captured nothing is skipped rather than written empty —
 * the same rule `hasExportableData` applies to a whole run, for the same
 * reason: an empty archive reads in the viewer as a run that captured nothing.
 */
export async function exportPerTestTraces(
  run: Readonly<ActiveRun>,
  request: Pick<
    TraceExportRequest,
    'outputDir' | 'sessionId' | 'format' | 'tracePolicy'
  >
): Promise<string[]> {
  const paths: string[] = []
  for (const slice of sliceRunByTest(run)) {
    if (!hasExportableData(slice.run)) {
      continue
    }
    if (!retentionDecision(slice.run, request.tracePolicy).retain) {
      continue
    }
    paths.push(
      await exportActiveRunTrace(slice.run, {
        outputDir: request.outputDir,
        sessionId: request.sessionId,
        ...(request.format ? { format: request.format } : {}),
        fileStem: `trace-${slugForTest(slice.uid, slice.title)}`
      })
    )
  }
  return paths
}
