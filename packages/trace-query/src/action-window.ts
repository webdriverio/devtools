import type { TracePlayerData } from '@wdio/devtools-shared'
import { actionByCallId } from './actions.js'
import { DEFAULT_ACTION_WINDOW_MS } from './constants.js'
import type { ActionWindow, TimeRange } from './types.js'

/** The action's span widened by the window, or undefined when no action is named. */
export function rangeAround(
  data: TracePlayerData,
  { action, windowMs }: ActionWindow
): TimeRange | undefined {
  if (action === undefined) {
    if (windowMs !== undefined) {
      throw new Error('windowMs needs an action to center the window on')
    }
    return undefined
  }
  const margin = windowMs ?? DEFAULT_ACTION_WINDOW_MS
  if (!Number.isFinite(margin) || margin < 0) {
    throw new Error(`windowMs must be a non-negative number, got ${margin}`)
  }
  const { command } = actionByCallId(data, action)
  return {
    from: (command.startTime ?? command.timestamp) - margin,
    to: command.timestamp + margin
  }
}
