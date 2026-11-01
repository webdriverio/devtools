import { AsyncLocalStorage } from 'node:async_hooks'
import { mapCommandToAction } from '@wdio/devtools-core'

import { INTERNAL_COMMANDS } from './constants.js'

export type CommandFrame = {
  command: string
  callSource?: string
  startTimestamp: number
}

/** Where a captured row sits: `id` is the wait it closes, `parentId` the wait that issued it. */
export interface CommandNesting {
  id?: number
  parentId?: number
}

interface OpenWait {
  id: number
  command: string
  /** The arguments its first hook saw: none for an element command, whose second hook WDIO fires from inside. */
  args: readonly unknown[]
  /** The wait's own frame, on the level it was issued from. */
  frame: CommandFrame
  parentFrames: CommandFrame[]
  /** The command this wait issued that is still running; anything below it is that command's own work. */
  frames: CommandFrame[]
  issuedAny: boolean
  /** An element wait's own `waitUntil` is running: what it issues are the wait's polls. */
  polling: boolean
}

/** An element wait polls through its own `waitUntil`; that loop and what the wait does around it are its implementation. */
const isElementWait = (command: string) =>
  mapCommandToAction(command)?.class === 'Element'

/** Marks the commands the service issues from its own hooks (screenshots, drains, injection): WDIO runs a command's
 *  hooks inside the async context that issued it, so they are told apart from the commands a wait issued. */
const serviceWork = new AsyncLocalStorage<true>()

export function runAsServiceWork<T>(work: () => Promise<T>): Promise<T> {
  return serviceWork.run(true, work)
}

export function isServiceWork(): boolean {
  return serviceWork.getStore() === true
}

/** The commands that become rows: the spec's top-of-stack command, and inside a wait each command the wait issued directly. */
export class CommandStack {
  #topLevel: CommandFrame[] = []
  #waits: OpenWait[] = []

  /** The id of the innermost open wait. */
  get parentId(): number | undefined {
    return this.#waits.at(-1)?.id
  }

  /** The frame a starting command opens, when it will be a row, and the level it was pushed onto. */
  enter(
    command: string,
    args: readonly unknown[],
    callSource: string | undefined,
    fromUserCode: boolean,
    issuedByService: boolean
  ): { frame: CommandFrame; frames: CommandFrame[] } | undefined {
    const wait = this.#waits.at(-1)
    if (wait && issuedByService) {
      return undefined
    }
    if (wait && command === 'waitUntil' && isElementWait(wait.command)) {
      wait.polling = true
      return undefined
    }
    const frames = wait ? wait.frames : this.#topLevel
    if (
      frames.length > 0 ||
      INTERNAL_COMMANDS.includes(command) ||
      (wait ? !this.#issuedBy(wait, command, args) : !fromUserCode)
    ) {
      return undefined
    }
    if (wait) {
      wait.issuedAny = true
    }
    const frame = { command, callSource, startTimestamp: Date.now() }
    frames.push(frame)
    return { frame, frames }
  }

  #issuedBy(
    wait: OpenWait,
    command: string,
    args: readonly unknown[]
  ): boolean {
    if (isElementWait(wait.command)) {
      return wait.polling
    }
    // WDIO's element wrapper fires the first hook with no arguments and the second, inside it, with the spec's.
    return !(
      command === wait.command &&
      !wait.issuedAny &&
      wait.args.length === 0 &&
      args.length > 0
    )
  }

  /** Opens a wait whose frame `enter` just pushed onto `frames`. */
  open(
    frame: CommandFrame,
    id: number,
    frames: CommandFrame[],
    args: readonly unknown[]
  ): void {
    this.#waits.push({
      id,
      command: frame.command,
      args,
      frame,
      parentFrames: frames,
      frames: [],
      issuedAny: false,
      polling: false
    })
  }

  /** The row a finished command settles: a top-level command, a command an open wait issued, or the wait itself. */
  settle(
    command: string,
    issuedByService: boolean
  ): { frame: CommandFrame; nesting: CommandNesting } | undefined {
    const wait = this.#waits.at(-1)
    if (!wait) {
      const frame = this.#topLevel.at(-1)
      return frame?.command === command
        ? { frame: this.#topLevel.pop()!, nesting: {} }
        : undefined
    }
    if (issuedByService) {
      return undefined
    }
    if (command === 'waitUntil' && isElementWait(wait.command)) {
      wait.polling = false
      return undefined
    }
    const issued = wait.frames.at(-1)
    if (issued?.command === command) {
      wait.frames.pop()
      return { frame: issued, nesting: { parentId: wait.id } }
    }
    if (command !== wait.command) {
      return undefined
    }
    this.#waits.pop()
    if (wait.parentFrames.at(-1) === wait.frame) {
      wait.parentFrames.pop()
    }
    return {
      frame: wait.frame,
      nesting: { id: wait.id, parentId: this.parentId }
    }
  }

  reset(): void {
    this.#topLevel = []
    this.#waits = []
  }
}
