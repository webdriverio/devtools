/**
 * A wait as one row, sent running at invocation and ended by `id`, and which
 * open wait issued a command, read from the async context of the call.
 *
 * Nightwatch runs a `waitUntil` condition from its own queue, so nothing on a
 * command the condition issues says a wait issued it, and the queue tree that
 * knows is not reachable from a plugin. The condition is the one piece of user
 * code a wait calls, so running it inside an `AsyncLocalStorage` scope marks
 * exactly the commands it invokes, across its own awaits; a condition that
 * calls another wait opens a scope inside the first. A `waitForElement*` polls
 * through the transport, never through `browser`, so its row has no children.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { commandFailure, mapCommandToAction } from '@wdio/devtools-shared'
import { commandRowSelector } from './assertTarget.js'
import type { SessionCapturer } from '../session.js'
import type { OpenWait, PendingCommand } from '../types.js'

export class WaitRows {
  readonly #scope = new AsyncLocalStorage<OpenWait>()

  constructor(private readonly capturer: SessionCapturer) {}

  /**
   * The innermost wait still open whose condition is making this call. An async
   * context outlives the call that created it (a timer or promise started inside
   * the condition keeps it after the wait has ended), so a closed wait hands the
   * call to the wait it was itself issued inside.
   */
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
    return { row, parent: cmd.parent, children: new Map(), closed: false }
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
}
