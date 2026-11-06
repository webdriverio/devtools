import {
  blobZipSource,
  buildTracePayload,
  openTraceArchive,
  readTraceEntries,
  type TraceArchive
} from '@wdio/devtools-trace/trace-reader'

import type {
  TraceReaderMessage,
  TraceReaderRequest
} from './trace-parse-protocol.js'

const reason = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** The trace reader's side of the protocol, run in the worker or, without one, in the page; it holds the opened zip until it is discarded. */
export function createTraceReader(
  post: (message: TraceReaderMessage) => void
): (request: TraceReaderRequest) => Promise<void> {
  let archive: TraceArchive | undefined
  return async (request) => {
    if (request.type === 'open') {
      try {
        post({ type: 'phase', phase: 'unpacking' })
        archive = await openTraceArchive(blobZipSource(request.blob))
        const entries = await readTraceEntries(archive)
        post({ type: 'phase', phase: 'building' })
        post({ type: 'done', data: await buildTracePayload(entries, archive) })
      } catch (error) {
        post({ type: 'error', message: reason(error) })
      }
      return
    }
    const { id, name } = request
    try {
      if (!archive) {
        throw new Error('No trace is open')
      }
      // Read from a Blob, so the bytes never sit in a shared buffer.
      const bytes = (await archive.read(name)) as Uint8Array<ArrayBuffer>
      post({ type: 'entry', id, blob: new Blob([bytes]) })
    } catch (error) {
      post({ type: 'entry-error', id, message: reason(error) })
    }
  }
}
