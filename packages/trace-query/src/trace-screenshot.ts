import {
  imageBytesDimensions,
  imageBytesMime,
  nearestFrame,
  type ImageSize,
  type TracePlayerData
} from '@wdio/devtools-shared'
import { actionByCallId } from './actions.js'
import { positiveInteger } from './budget.js'
import { captureSource, snapshotSourceOf } from './capture-source.js'
import {
  IMAGE_PIXELS_PER_TOKEN,
  MAX_LIST_TEXT_CHARS,
  MAX_SCREENSHOT_BYTES,
  SCREENSHOT_MAX_EDGE
} from './constants.js'
import { traceStateOf, type TraceState } from './open-trace.js'
import { returnedText } from './returned-text.js'
import type {
  CaptureSource,
  TraceHandle,
  TraceScreenshot,
  TraceScreenshotRequest
} from './types.js'

function fitWithin(size: ImageSize, maxEdge: number): ImageSize {
  const scale = Math.min(1, maxEdge / Math.max(size.width, size.height))
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale))
  }
}

/** The image of the capture the action shows, the same one `traceSnapshot` names; with no claim, the latest screencast frame at or before the action, as the player picks it but never falling forward to a later one. */
function imageFor(
  data: TracePlayerData,
  callId: string,
  timestamp: number
): { entry: string; capture: CaptureSource } | undefined {
  const claimed = snapshotSourceOf(data, callId)
  if (claimed?.entry) {
    const capture = captureSource(
      data,
      callId,
      claimed.timestamp,
      claimed.ownerCallId
    )
    return { entry: claimed.entry, capture }
  }
  // A frame that is some action's capture is left out: the writer's claims already said none is at or before this action.
  const claimedEntries = new Set(
    Object.values(data.snapshotSources ?? {}).map(({ entry }) => entry)
  )
  const frame = nearestFrame(
    data.frames.filter(
      (candidate) =>
        candidate.timestamp <= timestamp && !claimedEntries.has(candidate.entry)
    ),
    timestamp
  )
  return (
    frame && {
      entry: frame.entry,
      capture: captureSource(data, callId, frame.timestamp)
    }
  )
}

async function storedImage(
  { archive }: TraceState,
  entry: string
): Promise<Uint8Array | { unavailable: string }> {
  const declared = archive.sizeOf(entry)
  if (declared === undefined) {
    return { unavailable: 'The zip declares no size for the stored screenshot' }
  }
  if (declared > MAX_SCREENSHOT_BYTES) {
    return {
      unavailable: `The stored screenshot is ${declared} bytes, over the ${MAX_SCREENSHOT_BYTES}-byte read limit`
    }
  }
  try {
    return await archive.read(entry)
  } catch (error) {
    return {
      unavailable: `The stored screenshot could not be read: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/** The screenshot at an action, its stored bytes and the size to downscale them to, or why they did not come back; undefined when nothing was taken at or before it. */
export async function traceScreenshot(
  handle: TraceHandle,
  callId: string,
  request: TraceScreenshotRequest = {}
): Promise<TraceScreenshot | undefined> {
  const maxEdge = positiveInteger(
    'maxEdge',
    request.maxEdge ?? SCREENSHOT_MAX_EDGE
  )
  const state = traceStateOf(handle)
  const { command } = actionByCallId(state.data, callId)
  const found = imageFor(state.data, callId, command.timestamp)
  if (!found) {
    return undefined
  }
  const { capture } = found
  const unavailable = (why: string) => ({
    callId,
    capture,
    unavailable: returnedText(why, {
      state,
      kind: 'screenshot-unavailable',
      maxChars: MAX_LIST_TEXT_CHARS
    })
  })
  const bytes = await storedImage(state, found.entry)
  if (!(bytes instanceof Uint8Array)) {
    return unavailable(bytes.unavailable)
  }
  const mimeType = imageBytesMime(bytes)
  const size = imageBytesDimensions(bytes)
  if (!mimeType || !size) {
    return unavailable(
      'The stored screenshot is not a PNG or JPEG image with a readable size'
    )
  }
  const fit = fitWithin(size, maxEdge)
  return {
    callId,
    capture,
    mimeType,
    bytes,
    size,
    fit,
    tokens: Math.ceil((fit.width * fit.height) / IMAGE_PIXELS_PER_TOKEN)
  }
}
