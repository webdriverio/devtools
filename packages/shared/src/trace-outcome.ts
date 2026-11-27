// A zip records no test state, so the player and the trace query library both read a test's outcome from its rows.

import { effectiveFailure, retriedRows } from './command-failure.js'
import type {
  TraceActionChild,
  TraceActionGroupNode,
  TracePlayerData
} from './trace-player.js'
import type { CommandLog } from './types.js'

/** A failed action or step, actions and none failed, or none at all. */
export const TRACE_OUTCOME = {
  PASSED: 'passed',
  FAILED: 'failed',
  UNKNOWN: 'unknown'
} as const

export type TraceOutcome = (typeof TRACE_OUTCOME)[keyof typeof TRACE_OUTCOME]

function anyGroupFailed(children: readonly TraceActionChild[]): boolean {
  return children.some(
    (child) =>
      'group' in child &&
      (child.group.failed || anyGroupFailed(child.group.children))
  )
}

function outcomeOf(failed: boolean, hasActions: boolean): TraceOutcome {
  if (failed) {
    return TRACE_OUTCOME.FAILED
  }
  return hasActions ? TRACE_OUTCOME.PASSED : TRACE_OUTCOME.UNKNOWN
}

/** The `trace.commands` positions of every row in a tree, rows a wait issued included. */
export function commandIndicesIn(
  children: readonly TraceActionChild[]
): number[] {
  return children.flatMap((child) =>
    'group' in child
      ? commandIndicesIn(child.group.children)
      : [child.commandIndex, ...commandIndicesIn(child.children ?? [])]
  )
}

export function traceOutcome(data: TracePlayerData): TraceOutcome {
  const { commands } = data.trace
  const retried = retriedRows(commands)
  return outcomeOf(
    commands.some((command) => effectiveFailure(command, retried)) ||
      anyGroupFailed(data.groups ?? []),
    commands.length > 0
  )
}

/** One step of the action tree (a suite, a test) by the same rule; `retried` is `retriedRows` over every command. */
export function stepOutcome(
  step: TraceActionGroupNode,
  commands: readonly CommandLog[],
  retried: ReadonlySet<CommandLog>
): TraceOutcome {
  const indices = commandIndicesIn(step.children)
  return outcomeOf(
    Boolean(step.failed) ||
      anyGroupFailed(step.children) ||
      indices.some((index) => effectiveFailure(commands[index], retried)),
    indices.length > 0
  )
}
