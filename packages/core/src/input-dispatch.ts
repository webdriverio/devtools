import { isInputDispatchingCommand } from '@wdio/devtools-shared'

// A screenshot landing inside chromedriver's click — after it computed the
// element's coordinates, before it dispatches at them — makes the click report
// success while activating nothing (CLAUDE.md § Known debt has the measurements).
// One instance per adapter bundle, not per session: both halves are module-scoped
// and must be imported from the same bundle to see the same gate.

/** Bound on one command's suppression: a failing Nightwatch test discards its
 *  command queue, so the callback that closes a window may never fire. */
export const INPUT_DISPATCH_MAX_HOLD_MS = 3000

const NOOP = (): void => {}

export class InputDispatchGate {
  readonly #openedAt = new Map<number, number>()
  #nextToken = 0

  constructor(private readonly maxHoldMs = INPUT_DISPATCH_MAX_HOLD_MS) {}

  /**
   * Open a suppression window for `command` and return its closer. Always
   * returns a callable so call sites need no branch — for a command that
   * dispatches no input the closer is a no-op and nothing is tracked.
   */
  open(command: string): () => void {
    if (!isInputDispatchingCommand(command)) {
      return NOOP
    }
    const token = this.#nextToken++
    this.#openedAt.set(token, Date.now())
    return () => {
      this.#openedAt.delete(token)
    }
  }

  /**
   * Whether an unexpired window is open. Expired windows are dropped here, so a
   * closer that never runs costs one bounded stall rather than a permanent one
   * and cannot leak entries for the rest of the run.
   */
  isOpen(): boolean {
    const cutoff = Date.now() - this.maxHoldMs
    for (const [token, openedAt] of this.#openedAt) {
      if (openedAt <= cutoff) {
        this.#openedAt.delete(token)
      }
    }
    return this.#openedAt.size > 0
  }
}

const sharedGate = new InputDispatchGate()

/** Adapter side: open the window around a command. Returns its closer. */
export function beginInputDispatch(command: string): () => void {
  return sharedGate.open(command)
}

/** Recorder side: is a driver command dispatching input right now? */
export function isInputDispatchInFlight(): boolean {
  return sharedGate.isOpen()
}
