import type { CommandLog } from './types.js'

/** Same stable `id`, else the last row with the old timestamp (two rows can share a millisecond), else -1. */
export function replaceCommandIndex(
  current: readonly CommandLog[],
  oldTimestamp: number | undefined,
  command: CommandLog
): number {
  if (typeof command.id === 'number') {
    const byId = current.findIndex((c) => c.id === command.id)
    if (byId !== -1) {
      return byId
    }
  }
  return oldTimestamp === undefined
    ? -1
    : current.map((c) => c.timestamp).lastIndexOf(oldTimestamp)
}

/** A copy of `current` with the replacement applied, appended when it locates nothing. */
export function replaceCommand(
  current: readonly CommandLog[],
  oldTimestamp: number | undefined,
  command: CommandLog
): CommandLog[] {
  const next = [...current]
  const at = replaceCommandIndex(current, oldTimestamp, command)
  if (at === -1) {
    next.push(command)
  } else {
    next[at] = command
  }
  return next
}
