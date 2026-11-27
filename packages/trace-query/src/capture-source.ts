import type {
  TracePlayerData,
  TraceSnapshotSource
} from '@wdio/devtools-shared'
import { actionId, sinceStart } from './actions.js'
import { clipText } from './budget.js'
import { MAX_TITLE_CHARS } from './constants.js'
import type { CaptureSource } from './types.js'

/** The per-action capture an action shows, as the reader recorded it from the writer's claims. */
export function snapshotSourceOf(
  data: TracePlayerData,
  callId: string
): TraceSnapshotSource | undefined {
  const sources = data.snapshotSources
  // The keys are callIds a zip names, so a lookup must not reach the prototype.
  return sources && Object.prototype.hasOwnProperty.call(sources, callId)
    ? sources[callId]
    : undefined
}

/** A capture stamped at `timestamp`, credited to `ownerCallId` when it was taken for an action the trace holds a row for. */
export function captureSource(
  data: TracePlayerData,
  askedCallId: string,
  timestamp: number,
  ownerCallId?: string,
  maxTitleChars = MAX_TITLE_CHARS
): CaptureSource {
  // A foreign or edited zip can claim for a callId no row carries, so the owner is looked up without refusing.
  const owner =
    ownerCallId === undefined
      ? undefined
      : data.trace.commands.find(
          (command, index) => actionId(command, index) === ownerCallId
        )
  return {
    timeMs: sinceStart(data, timestamp),
    ...(owner
      ? {
          callId: ownerCallId,
          title: clipText(owner.title ?? owner.command, maxTitleChars)
        }
      : {}),
    own: ownerCallId === askedCallId
  }
}
