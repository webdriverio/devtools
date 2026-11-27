import {
  nestCommands,
  retriedRows,
  type CommandNode,
  type TracePlayerData
} from '@wdio/devtools-shared'
import { actionStatus, orderedActions, ownFailure } from './actions.js'
import { clipText, pageOf } from './budget.js'
import {
  ACTION_STATUS,
  MAX_LIST_TEXT_CHARS,
  MAX_LISTED_CHILDREN,
  MAX_TITLE_CHARS,
  PAGE_SCOPE
} from './constants.js'
import { traceStateOf } from './open-trace.js'
import { commandsOfStep } from './steps.js'
import type {
  ActionNode,
  ActionQuery,
  ActionRow,
  ActionStatus,
  Page,
  TraceHandle
} from './types.js'

/** The top-level rows in the trace's order, each with the rows it issued under it. */
export function actionTree(data: TracePlayerData): ActionNode[] {
  const ordered = orderedActions(data)
  const byCommand = new Map(ordered.map((action) => [action.command, action]))
  const retried = retriedRows(data.trace.commands)
  const toNode = ({ command, children }: CommandNode): ActionNode => ({
    action: byCommand.get(command)!,
    status: actionStatus(command, retried),
    children: children.map(toNode)
  })
  return nestCommands(ordered.map(({ command }) => command)).map(toNode)
}

function toRow({ action, status, children }: ActionNode): ActionRow {
  const error = ownFailure(action.command)
  return {
    callId: action.callId,
    title: clipText(
      action.command.title ?? action.command.command,
      MAX_TITLE_CHARS
    ),
    startMs: action.startMs,
    durationMs: action.endMs - action.startMs,
    ...(status === ACTION_STATUS.PASSED ? {} : { status }),
    ...(error ? { error: clipText(error, MAX_LIST_TEXT_CHARS) } : {}),
    ...listedChildren(children)
  }
}

function listedChildren(
  children: readonly ActionNode[]
): Pick<ActionRow, 'children' | 'omittedChildren'> {
  const omitted = children.length - MAX_LISTED_CHILDREN
  return {
    ...(children.length
      ? { children: children.slice(0, MAX_LISTED_CHILDREN).map(toRow) }
      : {}),
    ...(omitted > 0 ? { omittedChildren: omitted } : {})
  }
}

// A failed wait is kept for a failed poll under it, but `passed` names the row itself, or a failed wait with a passing poll would match.
function hasStatus(node: ActionNode, status: ActionStatus): boolean {
  if (status === ACTION_STATUS.PASSED) {
    return node.status === status
  }
  return (
    node.status === status ||
    node.children.some((child) => hasStatus(child, status))
  )
}

function matcher(
  data: TracePlayerData,
  query: ActionQuery
): (node: ActionNode) => boolean {
  const inStep =
    query.group === undefined ? undefined : commandsOfStep(data, query.group)
  const from = query.fromMs ?? -Infinity
  const to = query.toMs ?? Infinity
  return (node) =>
    (inStep === undefined || inStep.has(node.action.index)) &&
    (query.status === undefined || hasStatus(node, query.status)) &&
    node.action.endMs >= from &&
    node.action.startMs <= to
}

/** The trace's actions in the order they ran, a page at a time, with a wait's rows nested under it. */
export function traceActions(
  handle: TraceHandle,
  query: ActionQuery = {}
): Page<ActionRow> {
  const { data } = traceStateOf(handle)
  const rows = actionTree(data).filter(matcher(data, query)).map(toRow)
  const { status, group, fromMs, toMs } = query
  return pageOf(rows, query, {
    scope: JSON.stringify([PAGE_SCOPE.ACTIONS, status, group, fromMs, toMs])
  })
}
