import {
  isInputDispatchingCommand,
  occupiesDriver
} from '@wdio/devtools-shared'

// One gate per adapter bundle: a driver serves one request at a time, so a poll issued while it is held only queues.

/** Bound on one window: a failing Nightwatch test discards its command queue,
 *  so the callback that closes a window may never fire. */
export const DRIVER_ACTIVITY_MAX_HOLD_MS = 3000

/** What holds the driver: an input command no poll may overlap, a capture that
 *  delivers its own frame, or any other command. */
export type DriverWindowKind = 'command' | 'input' | 'capture'

const NOOP = (): void => {}

interface OpenWindow {
  openedAt: number
  kind: DriverWindowKind
}

export class InFlightGate {
  readonly #open = new Map<number, OpenWindow>()
  #nextToken = 0

  constructor(private readonly maxHoldMs = DRIVER_ACTIVITY_MAX_HOLD_MS) {}

  /** Open a window and return its closer; closing twice is harmless. */
  open(kind: DriverWindowKind = 'command'): () => void {
    const token = this.#nextToken++
    this.#open.set(token, { openedAt: Date.now(), kind })
    return () => {
      this.#open.delete(token)
    }
  }

  /**
   * Whether an unexpired window (of `kind`, when given) is open. Expired
   * windows are dropped here, so a closer that never runs costs one bounded
   * stall rather than a permanent one and cannot leak entries for the run.
   */
  isOpen(kind?: DriverWindowKind): boolean {
    const cutoff = Date.now() - this.maxHoldMs
    let found = false
    for (const [token, window] of this.#open) {
      if (window.openedAt <= cutoff) {
        this.#open.delete(token)
      } else if (kind === undefined || window.kind === kind) {
        found = true
      }
    }
    return found
  }
}

const sharedGate = new InFlightGate()

/** Adapter side: open the window around a runner command. Returns its closer,
 *  a no-op for a command that does not hold the driver (`occupiesDriver`). */
export function beginDriverCommand(command: string): () => void {
  if (isInputDispatchingCommand(command)) {
    return sharedGate.open('input')
  }
  return occupiesDriver(command) ? sharedGate.open('command') : NOOP
}

/** Capture side: open the window around a per-action capture's probes. */
export function beginDriverCapture(): () => void {
  return sharedGate.open('capture')
}

/** Recorder side: is a command or a capture holding the driver right now? */
export function isDriverBusy(): boolean {
  return sharedGate.isOpen()
}

/** Recorder side: is a command dispatching input right now? A poll inside it makes the click activate nothing. */
export function isInputDispatchInFlight(): boolean {
  return sharedGate.isOpen('input')
}

/** Recorder side: is a per-action capture running? Its own screenshot is the frame a poll would add. */
export function isCaptureInFlight(): boolean {
  return sharedGate.isOpen('capture')
}
