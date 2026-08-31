/**
 * Builds a trace artifact from the run the backend is already accumulating.
 *
 * The transforms are `@wdio/devtools-trace`, the same code the JS adapters run
 * in-process — the point of the split is that there is one implementation, not
 * one per language. This module is only the adapter between the accumulator's
 * shape and the exporter's, plus the two derivations the wire does not carry.
 */

import type { TestMetadataMap, TraceExportRequest } from '@wdio/devtools-shared'
import {
  writeTraceZip,
  type TraceCapturer
} from '@wdio/devtools-trace/trace-exporter'
import type { ActiveRun, TimeWindowNode } from './baseline/types.js'

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
    startWallTime: run.startedAt
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

export async function exportActiveRunTrace(
  run: Readonly<ActiveRun>,
  request: Pick<
    TraceExportRequest,
    'outputDir' | 'sessionId' | 'format' | 'fileStem'
  >
): Promise<string> {
  if (!hasExportableData(run)) {
    throw new Error('nothing captured for this run')
  }
  // `capabilities` is not passed separately: writeTraceZip spreads the
  // capturer's own metadata, which already carries it.
  return writeTraceZip(toCapturer(run), {
    outputDir: request.outputDir,
    sessionId: request.sessionId,
    ...(request.format ? { format: request.format } : {}),
    ...(request.fileStem ? { fileStem: request.fileStem } : {}),
    // Omitted when empty rather than passed as []: the exporter treats absence
    // as "no dense filmstrip" and keeps the sparse per-action one, which is
    // what an adapter that did not ask for frames should still get.
    ...(run.screencastFrames.length
      ? { screencastFrames: run.screencastFrames }
      : {}),
    testMetadata: testMetadataFromNodes(run.nodes)
  })
}
