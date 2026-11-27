import {
  nestCommands,
  retriedRows,
  type CommandNode,
  type TracePlayerData
} from '@wdio/devtools-shared'
import { actionStatus, orderedActions, ownFailure } from './actions.js'
import { clipText, itemBudget, pageOf, queryBudgetOf } from './budget.js'
import {
  ACTION_STATUS,
  MAX_LIST_TEXT_CHARS,
  MAX_LISTED_CHILDREN,
  MAX_TITLE_CHARS,
  MIN_TEXT_CHARS,
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

function withChildren(
  row: ActionRow,
  children: ActionRow[],
  omitted: number
): ActionRow {
  const { children: _children, omittedChildren: _omitted, ...own } = row
  return {
    ...own,
    ...(children.length ? { children } : {}),
    ...(omitted > 0 ? { omittedChildren: omitted } : {})
  }
}

// A page always holds one row, so a row larger than a page's budget sheds the rows it issued, then cuts its own text, rather than overrunning maxChars.
function rowWithin(row: ActionRow, budget: number): ActionRow {
  const size = (candidate: ActionRow) => JSON.stringify(candidate).length
  if (size(row) <= budget) {
    return row
  }
  const children = row.children ?? []
  const omitted = row.omittedChildren ?? 0
  for (let keep = children.length - 1; keep >= 0; keep--) {
    const shed = withChildren(
      row,
      children.slice(0, keep),
      omitted + children.length - keep
    )
    if (size(shed) <= budget) {
      return shed
    }
  }
  const bare = withChildren(row, [], omitted + children.length)
  return {
    ...bare,
    title: clipText(bare.title, MIN_TEXT_CHARS),
    ...(bare.error ? { error: clipText(bare.error, MIN_TEXT_CHARS) } : {})
  }
}

/** The trace's actions in the order they ran, a page at a time, with a wait's rows nested under it. */
export function traceActions(
  handle: TraceHandle,
  query: ActionQuery = {}
): Page<ActionRow> {
  queryBudgetOf(query.maxChars)
  const { data } = traceStateOf(handle)
  const { status, group, fromMs, toMs } = query
  const scope = JSON.stringify([
    PAGE_SCOPE.ACTIONS,
    status,
    group,
    fromMs,
    toMs
  ])
  const rows = actionTree(data).filter(matcher(data, query)).map(toRow)
  const budget = itemBudget(rows.length, query.maxChars, scope)
  return pageOf(
    rows.map((row) => rowWithin(row, budget)),
    query,
    { scope }
  )
}
