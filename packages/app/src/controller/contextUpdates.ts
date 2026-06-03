/**
 * Pure transforms for the live-context arrays managed by DataManager.
 *
 * Extracted from DataManager so the controller stays under the file-size
 * cap and these merges can be unit-tested in isolation. Each function
 * takes the current context value + an incoming payload and returns the
 * new value the ContextProvider should publish.
 */

import type { CommandLog, NetworkRequest } from '@wdio/devtools-shared'

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
