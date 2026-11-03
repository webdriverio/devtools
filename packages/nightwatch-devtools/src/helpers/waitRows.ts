// A wait's row, and which open wait issued a command: Nightwatch's queue hides that, so the condition runs in an AsyncLocalStorage scope.

import { AsyncLocalStorage } from 'node:async_hooks'
import { commandFailure, mapCommandToAction } from '@wdio/devtools-shared'
import { commandRowSelector } from './assertTarget.js'
import type { SessionCapturer } from '../session.js'
import type { OpenWait, PendingCommand } from '../types.js'

const NOT_RUN_ERROR = 'NotRunError'

export class WaitRows {
  readonly #scope = new AsyncLocalStorage<OpenWait>()
  readonly #open = new Set<OpenWait>()

  constructor(private readonly capturer: SessionCapturer) {}

  /** The innermost open wait making this call; a scope outlives its wait, so a closed one defers to its own parent. */
  enclosing(): OpenWait | undefined {
    let wait = this.#scope.getStore()
    while (wait?.closed) {
      wait = wait.parent
    }
    return wait
  }

  /** Send the wait's row running, before the queue runs it, so its condition's commands have a row to name. */
  open(cmd: PendingCommand): OpenWait {
    const row = this.capturer.openCommand(cmd.methodName, cmd.logArgs, {
      testUid: cmd.testUid,
      callSource: cmd.callSource,
      startTime: cmd.invokedAt,
      sequence: cmd.sequence,
      selector: commandRowSelector(cmd.methodName, cmd.logArgs),
      parentId: cmd.parent?.row.id
    })
    const wait = { row, parent: cmd.parent, children: new Map(), closed: false }
    this.#open.add(wait)
    return wait
  }

  /** The args a wait is called with: a `waitUntil` condition runs every poll inside the wait's scope. */
  args(cmd: PendingCommand): unknown[] {
    const [condition, ...rest] = cmd.logArgs
    const wait = cmd.wait
    if (!wait || typeof condition !== 'function') {
      return cmd.logArgs
    }
    const scope = this.#scope
    // `this` is passed through: Nightwatch binds the condition to its api.
    const scoped = function (this: unknown, ...args: unknown[]) {
      return scope.run(wait, () => condition.apply(this, args))
    }
    return [scoped, ...rest]
  }

  /** End the wait's row by `id`, stamped at completion; a wait Nightwatch reports as `false` timed out. */
  close(
    wait: OpenWait,
    result: unknown,
    error: Error | undefined,
    completedAt: number
  ): void {
    wait.closed = true
    this.#open.delete(wait)
    const { row } = wait
    const action = mapCommandToAction(row.command)
    const timeout =
      !error && action ? commandFailure({ ...row, result }, action) : undefined
    this.capturer.closeCommand(
      row,
      result,
      error ?? (timeout && new Error(timeout.message)),
      completedAt
    )
  }

  /** Close every wait still open as not run: Nightwatch drops a queued wait, callback and all, when an earlier assert aborts the queue. */
  closeUnrun(): OpenWait[] {
    const unrun = [...this.#open]
    for (const wait of unrun) {
      wait.closed = true
      this.#open.delete(wait)
      const error = new Error(
        `${wait.row.command} did not run: the test ended before Nightwatch reached it`
      )
      error.name = NOT_RUN_ERROR
      this.capturer.closeCommand(
        wait.row,
        undefined,
        error,
        wait.row.startTime ?? wait.row.timestamp,
        false
      )
    }
    return unrun
  }
}
