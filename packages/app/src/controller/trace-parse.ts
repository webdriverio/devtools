import {
  parseTraceEntries,
  unzipTraceZip
} from '@wdio/devtools-trace/trace-reader'

import type { TraceParseMessage } from './trace-parse-protocol.js'

/** The trace reader's side of the protocol, run in the worker or, without one, in the page. */
export function answerParseRequest(
  bytes: ArrayBuffer,
  post: (message: TraceParseMessage) => void
): void {
  try {
    post({ type: 'phase', phase: 'unpacking' })
    const entries = unzipTraceZip(new Uint8Array(bytes))
    post({ type: 'phase', phase: 'building' })
    post({ type: 'done', data: parseTraceEntries(entries) })
  } catch (error) {
    post({
      type: 'error',
      message: error instanceof Error ? error.message : String(error)
    })
  }
}
