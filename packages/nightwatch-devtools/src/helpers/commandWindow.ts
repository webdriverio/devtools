import { beginDriverCommand } from '@wdio/devtools-core'
import {
  READ_ONLY_COMMANDS,
  isInputDispatchingCommand,
  mapCommandToAction
} from '@wdio/devtools-shared'

const NOOP = (): void => {}

/** Nightwatch v3's `browser.element()` builds a scoped element and never calls back, outside backwards-compatibility mode. */
const BUILDER_COMMANDS: ReadonlySet<string> = new Set(['element'])

/** Whether a wrapped command is known to reach the driver and call back. The
 *  window closes from the appended callback, so a builder (`actions()`,
 *  `element()`) or a custom command that never calls back would hold the
 *  filmstrip's gate to its bound on every call. */
export function callsBackFromDriver(command: string): boolean {
  if (BUILDER_COMMANDS.has(command)) {
    return false
  }
  return (
    isInputDispatchingCommand(command) ||
    mapCommandToAction(command) !== null ||
    READ_ONLY_COMMANDS.has(command)
  )
}

/** Opens core's driver-activity window for a command that calls back from the driver. */
export function beginCommandWindow(command: string): () => void {
  return callsBackFromDriver(command) ? beginDriverCommand(command) : NOOP
}
