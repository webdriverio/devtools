import { RetryTracker } from '@wdio/devtools-core'

import type { CommandLog } from './types.js'

type Row = CommandLog & { _id?: number }

/** The capturer's row log and the wire it sends rows over. */
export interface RowChannel {
  log(): CommandLog[]
  nextId(): number
  sendCommand(row: Row): number
  sendReplaceCommand(oldTimestamp: number, row: Row): void
}

/** The rows of a wait and of what it issued. Each carries an `id`, so a child can name its wait and a poll can replace its row. */
export class WaitRows {
  #channel: RowChannel
  /** Per wait, the row each distinct call it issued folds into (signature → id). */
  #issued = new Map<number, Map<string, number>>()

  constructor(channel: RowChannel) {
    this.#channel = channel
  }

  /**
   * Sends a wait's running row, or a row a wait issued: under one parent, a call it repeats replaces its first row. A
   * repeat with no call site is a poll a timer issued, the same call as the first poll, which ran with the spec's frame.
   */
  send(entry: Row): number {
    const sig = RetryTracker.signature(
      entry.command,
      entry.args,
      entry.callSource
    )
    const anySource = RetryTracker.signature(entry.command, entry.args)
    const { parentId } = entry
    const rows =
      parentId === undefined
        ? undefined
        : (this.#issued.get(parentId) ?? new Map<string, number>())
    const at = this.#indexOf(rows?.get(entry.callSource ? sig : anySource))
    if (at !== -1) {
      this.#replaceAt(at, entry)
      return entry.id!
    }
    const id = this.#channel.nextId()
    entry.id = entry._id = id
    this.#channel.log().push(entry)
    this.#channel.sendCommand(entry)
    if (rows) {
      this.#issued.set(parentId!, rows.set(sig, id).set(anySource, id))
    }
    return id
  }

  /** The finished wait replaces its running row by id, moved to where it completed so the log stays in completion order. */
  close(entry: Row, id: number): void {
    const log = this.#channel.log()
    entry.id = entry._id = id
    const at = this.#indexOf(id)
    const running = at === -1 ? undefined : log.splice(at, 1)[0]
    log.push(entry)
    this.#channel.sendReplaceCommand(
      running?.timestamp ?? entry.timestamp,
      entry
    )
    if (entry.parentId === undefined) {
      this.#issued.clear()
    }
  }

  reset(): void {
    this.#issued.clear()
  }

  #indexOf(id: number | undefined): number {
    return id === undefined
      ? -1
      : this.#channel.log().findIndex((row) => row.id === id)
  }

  #replaceAt(at: number, entry: Row): void {
    const log = this.#channel.log()
    const previous = log[at]!
    entry.id = entry._id = previous.id
    entry.callSource ||= previous.callSource
    log[at] = entry
    this.#channel.sendReplaceCommand(previous.timestamp, entry)
  }
}
