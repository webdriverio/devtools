import { strFromU8, unzipSync } from 'fflate'
import {
  nearestFrame,
  type CommandLog,
  type TracePlayerData
} from '@wdio/devtools-shared'

/** One entry of a zip, read the way the player reads it on demand. */
export function zipEntry(zip: Uint8Array, name: string): Uint8Array {
  const entry = unzipSync(zip, { filter: (file) => file.name === name })[name]
  if (!entry) {
    throw new Error(`no entry ${name}`)
  }
  return entry
}

/** Each frame's image, base64, in filmstrip order. */
export function frameImages(zip: Uint8Array, data: TracePlayerData): string[] {
  return data.frames.map((frame) =>
    Buffer.from(zipEntry(zip, frame.entry)).toString('base64')
  )
}

/** The image the player shows for a command, base64. */
export function commandImage(
  zip: Uint8Array,
  data: TracePlayerData,
  command: CommandLog
): string | undefined {
  const frame = nearestFrame(data.frames, command.timestamp)
  return frame && Buffer.from(zipEntry(zip, frame.entry)).toString('base64')
}

/** A request's response body, inline or read from the entry the payload names. */
export function responseBodyOf(
  zip: Uint8Array,
  data: TracePlayerData,
  requestId: string
): string | undefined {
  const request = data.trace.networkRequests.find(({ id }) => id === requestId)
  const entry = data.responseBodies?.[requestId]
  return request?.responseBody ?? (entry && strFromU8(zipEntry(zip, entry)))
}
