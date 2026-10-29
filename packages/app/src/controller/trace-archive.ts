import type { TracePlayerData } from '@wdio/devtools-shared'

/** Parse a trace.zip the viewer picked, entirely in this tab. */
export async function readTraceArchive(file: Blob): Promise<TracePlayerData> {
  // Loaded on demand so the live dashboard never downloads the reader.
  const { parseTraceZip } = await import('@wdio/devtools-trace/trace-reader')
  let data: TracePlayerData
  try {
    data = parseTraceZip(new Uint8Array(await file.arrayBuffer()))
  } catch (error) {
    throw new Error(`Not a readable trace: ${(error as Error).message}`)
  }
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
