import type { TracePlayerData } from '@wdio/devtools-shared'
import {
  openTraceArchive,
  readTracePayload,
  type TraceArchive,
  type ZipSource
} from '@wdio/devtools-trace/trace-reader'
import type { TraceHandle } from './types.js'

/** What a query reads behind a handle: the parsed payload, and the archive for entries read on demand. */
export interface TraceState {
  data: TracePlayerData
  archive: TraceArchive
}

// The payload's shape follows shared, so it stays behind the handle rather than on the published API.
const states = new WeakMap<TraceHandle, TraceState>()

/** Opens a trace zip from any byte source, reading only the entries the payload is built from. */
export async function openTraceSource(source: ZipSource): Promise<TraceHandle> {
  const archive = await openTraceArchive(source)
  const data = await readTracePayload(archive)
  const handle = Object.freeze({}) as TraceHandle
  states.set(handle, { data, archive })
  return handle
}

export function traceStateOf(handle: TraceHandle): TraceState {
  const state = states.get(handle)
  if (!state) {
    throw new Error('Not a trace handle: open the trace with openTraceSource')
  }
  return state
}
