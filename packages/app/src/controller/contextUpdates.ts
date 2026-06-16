/**
 * Pure transforms for the live-context arrays managed by DataManager.
 *
 * Extracted from DataManager so the controller stays under the file-size
 * cap and these merges can be unit-tested in isolation. Each function
 * takes the current context value + an incoming payload and returns the
 * new value the ContextProvider should publish.
 */

import type {
  CommandLog,
  NetworkRequest,
  Metadata,
  MetadataBySession
} from '@wdio/devtools-shared'

/**
 * Replace an existing command entry (matched first by stable `id`, then by
 * `timestamp` as a fallback for runners that don't surface ids). When no
 * match is found, the new entry is appended.
 */
export function replaceCommand(
  current: CommandLog[],
  oldTimestamp: number,
  newCommand: CommandLog
): CommandLog[] {
  let idx = -1
  const newId = (newCommand as CommandLog & { id?: number }).id
  if (typeof newId === 'number') {
    idx = current.findIndex(
      (c) => (c as CommandLog & { id?: number }).id === newId
    )
  }
  if (idx === -1) {
    idx = current.map((c) => c.timestamp).lastIndexOf(oldTimestamp)
  }
  if (idx !== -1) {
    const next = [...current]
    next[idx] = newCommand
    return next
  }
  return [...current, newCommand]
}

/**
 * Merge incoming network requests into the current list, deduping by `id`.
 * Requests without an id are always appended.
 */
export function mergeNetworkRequests(
  current: NetworkRequest[],
  incoming: NetworkRequest[]
): NetworkRequest[] {
  const byId = new Map<string, number>()
  current.forEach((r, i) => {
    if (r?.id) {
      byId.set(r.id, i)
    }
  })
  const next = [...current]
  for (const req of incoming) {
    if (!req?.id) {
      next.push(req)
      continue
    }
    const existing = byId.get(req.id)
    if (existing !== undefined) {
      next[existing] = req
    } else {
      byId.set(req.id, next.length)
      next.push(req)
    }
  }
  return next
}

/** Key for metadata received before any `sessionId` is known; folded into the
 *  first real session once it arrives so early `{ url }`/viewport aren't lost. */
export const PENDING_SESSION_KEY = '__pending__'

export interface MetadataMergeState {
  bySession: MetadataBySession
  /** Most-recently-seen sessionId — target for messages without their own. */
  currentSessionId?: string
}

export interface MetadataMergeResult extends MetadataMergeState {
  /** Merged metadata for the resolved session — what `metadataContext` publishes. */
  active: Metadata
}

/**
 * Merge an incoming metadata message into a per-session map, immutably.
 *
 * Messages carry `sessionId` on session start but not on every update (e.g. a
 * `url` change), so updates without one attribute to the current session. A
 * message arriving before any session is known is buffered under
 * {@link PENDING_SESSION_KEY} and folded into the first real session.
 */
export function mergeSessionMetadata(
  state: MetadataMergeState,
  incoming: Metadata
): MetadataMergeResult {
  const bySession: MetadataBySession = { ...state.bySession }
  // Boundary broadcasts can carry an empty-string sessionId; treat it as absent
  // so it attributes to the current session instead of forging a ghost entry.
  const incomingSessionId = incoming.sessionId || undefined
  const sessionId =
    incomingSessionId ?? state.currentSessionId ?? PENDING_SESSION_KEY

  // Drop empty/undefined fields so a later partial message (e.g. the
  // session-start broadcast that carries `url: ''`) can't wipe a real value
  // already captured for the session.
  const updates = Object.fromEntries(
    Object.entries(incoming).filter(
      ([, v]) => v !== undefined && v !== null && v !== ''
    )
  ) as Partial<Metadata>

  let merged: Metadata = { ...bySession[sessionId], ...updates }

  // First real session absorbs anything buffered before a sessionId existed.
  if (
    incomingSessionId &&
    sessionId !== PENDING_SESSION_KEY &&
    bySession[PENDING_SESSION_KEY]
  ) {
    merged = { ...bySession[PENDING_SESSION_KEY], ...merged }
    delete bySession[PENDING_SESSION_KEY]
  }

  bySession[sessionId] = merged
  return {
    bySession,
    currentSessionId: incomingSessionId ?? state.currentSessionId,
    active: merged
  }
}
