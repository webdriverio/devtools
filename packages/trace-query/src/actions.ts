import {
  effectiveFailure,
  rowFailure,
  type CommandLog,
  type TracePlayerData
} from '@wdio/devtools-shared'
import { ACTION_STATUS } from './constants.js'
import type { ActionStatus, OrderedAction } from './types.js'

/** The id a row is addressed by. The reader gives every row of a zip a callId; a row without one is named by its position so it stays reachable. */
export function actionId(command: CommandLog, index: number): string {
  return command.callId ?? `row@${index}`
}

/** Ms from the trace's start, rounded. */
export function sinceStart(data: TracePlayerData, time: number): number {
  return Math.round(time - data.startTime)
}

const startOf = (command: CommandLog) => command.startTime ?? command.timestamp

function orderedAction(
  data: TracePlayerData,
  command: CommandLog,
  index: number
): OrderedAction {
  return {
    command,
    index,
    callId: actionId(command, index),
    startMs: sinceStart(data, startOf(command)),
    endMs: sinceStart(data, command.timestamp)
  }
}

/** Every row by start time, then position. The writer floors each start at the previous action's end and the reader keeps no `sequence`, so a zip's start order is already the order the test issued its rows in. */
export function orderedActions(data: TracePlayerData): OrderedAction[] {
  return data.trace.commands
    .map((command, index) => orderedAction(data, command, index))
    .sort(
      (a, b) => startOf(a.command) - startOf(b.command) || a.index - b.index
    )
}

/** The row a callId names, with its position and clock; refuses one the trace does not hold. */
export function actionByCallId(
  data: TracePlayerData,
  callId: string
): OrderedAction {
  const { commands } = data.trace
  const index = commands.findIndex(
    (command, at) => actionId(command, at) === callId
  )
  if (index < 0) {
    throw new Error(
      `The trace has no action ${JSON.stringify(callId)}: pass a callId from the action list`
    )
  }
  return orderedAction(data, commands[index], index)
}

/** Why a row failed on its own, whether or not a passing wait retried it. */
export function ownFailure(command: CommandLog): string | undefined {
  return rowFailure(command)?.message
}

/** `retried` is `retriedRows` over every row of the trace. */
export function actionStatus(
  command: CommandLog,
  retried: ReadonlySet<CommandLog>
): ActionStatus {
  if (retried.has(command)) {
    return ACTION_STATUS.RETRIED
  }
  return effectiveFailure(command, retried)
    ? ACTION_STATUS.FAILED
    : ACTION_STATUS.PASSED
}
