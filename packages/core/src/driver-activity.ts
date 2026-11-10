import { occupiesDriver } from '@wdio/devtools-shared'

// A driver serves one session's requests one at a time, so a filmstrip poll
// issued while a command or a capture holds the driver only queues in front of
// the test, and a poll landing inside chromedriver's click (after it computed
// the element's coordinates, before it dispatches at them) makes the click
// report success while activating nothing. One instance per adapter bundle, not
// per session: both halves are module-scoped and must be imported from the same
// bundle to see the same gate.

/** Bound on one window: a failing Nightwatch test discards its command queue,
 *  so the callback that closes a window may never fire. */
export const DRIVER_ACTIVITY_MAX_HOLD_MS = 3000

const NOOP = (): void => {}

export class InFlightGate {
  readonly #openedAt = new Map<number, number>()
  #nextToken = 0

  constructor(private readonly maxHoldMs = DRIVER_ACTIVITY_MAX_HOLD_MS) {}

  /** Open a window and return its closer; closing twice is harmless. */
  open(): () => void {
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

const sharedGate = new InFlightGate()

/** Adapter side: open the window around a runner command. Returns its closer,
 *  a no-op for a command that does not hold the driver (`occupiesDriver`). */
export function beginDriverCommand(command: string): () => void {
  return occupiesDriver(command) ? sharedGate.open() : NOOP
}

/** Capture side: open the window around a per-action capture's probes. */
export function beginDriverCapture(): () => void {
  return sharedGate.open()
}

/** Recorder side: is a command or a capture holding the driver right now? */
export function isDriverBusy(): boolean {
  return sharedGate.isOpen()
}
