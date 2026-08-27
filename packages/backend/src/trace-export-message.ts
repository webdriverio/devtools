/**
 * Worker control frame for server-side trace export. Split from
 * `worker-message-handler` so its dispatcher stays a dispatcher — this is the
 * only control scope that does real work rather than routing.
 */

import logger from '@wdio/logger'
import {
  TRACE_EXPORT_SCOPE,
  type TraceExportRequest,
  type TraceExportResult
} from '@wdio/devtools-shared'
import type { ActiveRun } from './baseline/types.js'
import { exportActiveRunTrace } from './trace-export.js'

const log = logger('@wdio/devtools-backend')

export interface TraceExportDeps {
  activeRun: () => Readonly<ActiveRun>
  /** Back down the worker's own socket. Absent when the socket has already
   *  gone, which is ordinary at the end of a run. */
  replyToWorker?: (message: string) => void
}

/**
 * A request is only actionable with all three fields. A partial frame would
 * otherwise write `trace-undefined` into a directory named `undefined`.
 */
export function asTraceExportRequest(
  data: Record<string, unknown> | undefined
): TraceExportRequest | undefined {
  if (
    typeof data?.requestId !== 'string' ||
    typeof data.outputDir !== 'string' ||
    typeof data.sessionId !== 'string'
  ) {
    return undefined
  }
  return data as unknown as TraceExportRequest
}

/**
 * Build the artifact and answer on the worker's own socket.
 *
 * Deliberately never rejects: an adapter asks for this while finishing a run,
 * and a failed export must report itself rather than take the run down. The
 * reason travels in `error` so the adapter can log something actionable
 * instead of the artifact silently not appearing.
 */
export async function runTraceExport(
  request: TraceExportRequest,
  deps: TraceExportDeps
): Promise<void> {
  const reply = (result: TraceExportResult) =>
    deps.replyToWorker?.(
      JSON.stringify({ scope: TRACE_EXPORT_SCOPE.result, data: result })
    )
  try {
    const path = await exportActiveRunTrace(deps.activeRun(), {
      outputDir: request.outputDir,
      sessionId: request.sessionId,
      format: request.format,
      fileStem: request.fileStem
    })
    log.info(`Trace exported for session ${request.sessionId}: ${path}`)
    reply({ requestId: request.requestId, path })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    log.error(`Trace export failed for session ${request.sessionId}: ${error}`)
    reply({ requestId: request.requestId, error })
  }
}

/**
 * Handle the frame if it is one, and report whether it was. Returns
 * synchronously — the export runs detached, because the worker keeps streaming
 * while it writes and blocking the message loop would stall the run.
 */
export function tryHandleTraceExportMessage(
  parsed: { scope?: string; data?: Record<string, unknown> },
  deps: TraceExportDeps
): boolean {
  if (parsed.scope !== TRACE_EXPORT_SCOPE.request) {
    return false
  }
  const request = asTraceExportRequest(parsed.data)
  if (!request) {
    log.error('Ignoring a trace export request missing required fields')
    return true
  }
  void runTraceExport(request, deps)
  return true
}
