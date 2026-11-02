import type { TracePlayerData } from '@wdio/devtools-shared'

import { HOSTED_PLAYER } from './constants.js'
import type {
  TraceOpenProgress,
  TraceParseMessage,
  TraceParseRequest,
  TraceParseResult
} from './trace-parse-protocol.js'

/** Runs the trace reader on a zip's bytes; rejects only if the reader itself fails. */
export type TraceParser = (
  bytes: ArrayBuffer,
  onPhase: TraceOpenProgress
) => Promise<TraceParseResult>

function relay(
  onPhase: TraceOpenProgress,
  settle: (result: TraceParseResult) => void
): (message: TraceParseMessage) => void {
  return (message) =>
    message.type === 'phase' ? onPhase(message.phase) : settle(message)
}

/** Parses off the main thread, so the tab stays responsive for the whole read. */
export const parseInWorker: TraceParser = (bytes, onPhase) => {
  const worker = new Worker(
    new URL('./trace-parse.worker.ts', import.meta.url),
    { type: 'module' }
  )
  return new Promise<TraceParseResult>((resolve, reject) => {
    const answer = relay(onPhase, resolve)
    worker.addEventListener('message', (event) => answer(event.data))
    worker.addEventListener('messageerror', () =>
      reject(new Error('The trace reader sent a reply this page cannot read'))
    )
    // The reader catches its own errors, so this is a worker that never started.
    worker.addEventListener('error', (event) =>
      reject(
        new Error(
          `The trace reader could not start${event.message ? `: ${event.message}` : ''}`
        )
      )
    )
    const request: TraceParseRequest = { bytes }
    worker.postMessage(request, [bytes])
  }).finally(() => worker.terminate())
}

/** The same reader in this thread, for a runtime with no Worker. */
export const parseInPage: TraceParser = async (bytes, onPhase) => {
  // Loaded on demand so the live dashboard never downloads the reader.
  const { answerParseRequest } = await import('./trace-parse.js')
  return new Promise((resolve) =>
    answerParseRequest(bytes, relay(onPhase, resolve))
  )
}

// Gated on the build flag too, so the live dashboard's bundle never references the worker.
const defaultParser = (): TraceParser =>
  HOSTED_PLAYER && typeof Worker === 'function' ? parseInWorker : parseInPage

/** Parse a trace.zip the viewer picked, entirely in this tab. */
export async function readTraceArchive(
  file: Blob,
  onPhase: TraceOpenProgress = () => {},
  parse: TraceParser = defaultParser()
): Promise<TracePlayerData> {
  onPhase('reading')
  const result = await parse(await file.arrayBuffer(), onPhase)
  if (result.type === 'error') {
    throw new Error(`Not a readable trace: ${result.message}`)
  }
  const { data } = result
  const { commands, consoleLogs, networkRequests, mutations } = data.trace
  // A zip with no trace stream in it parses to a payload with nothing to show.
  if (
    !commands.length &&
    !data.frames.length &&
    !consoleLogs.length &&
    !networkRequests.length &&
    !mutations.length
  ) {
    throw new Error('No trace found in this archive')
  }
  return data
}
