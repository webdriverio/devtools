// Pure helpers behind the player's collapsible action tree: flattening the
// tree into render rows and deciding which nodes start expanded. A node is a
// group, or a command row with the rows its execution issued (a wait's reads).

import type {
  CommandLog,
  TraceActionChild,
  TraceActionCommandNode,
  TraceActionGroupNode
} from '@wdio/devtools-shared'

export interface GroupRow {
  kind: 'group'
  group: TraceActionGroupNode
  depth: number
  expanded: boolean
}

export interface CommandRow {
  kind: 'command'
  commandIndex: number
  depth: number
  /** Set on a row that issued others: whether they are rendered below it. */
  expanded?: boolean
}

export type ActionTreeRow = GroupRow | CommandRow

/** Detail of the `group-toggle` event a collapsible row sends: its key, and whether it was open. */
export interface RowToggleDetail {
  key: string
  expanded: boolean
}

/** Identity of a tree node, as `rowKey` names the row it renders as. */
export function nodeKey(child: TraceActionChild): string {
  return 'group' in child
    ? `group:${child.group.callId}`
    : `command:${child.commandIndex}`
}

/** Identity of a render row. Rows are keyed on it so an expand/collapse moves
 *  each element with the action it belongs to; reusing whatever element sat at
 *  that index hands the new action the old row's local state. Namespaced so a
 *  callId that reads as a number can't collide with a command index. */
export function rowKey(row: ActionTreeRow): string {
  return row.kind === 'group'
    ? nodeKey({ group: row.group })
    : nodeKey({ commandIndex: row.commandIndex })
}

const childrenOf = (child: TraceActionChild): TraceActionChild[] =>
  ('group' in child ? child.group.children : child.children) ?? []

/** Keys of every node above the active command, found in one walk so each node's default is a set lookup. */
export function activeAncestorKeys(
  children: readonly TraceActionChild[],
  activeCommandIndex?: number
): Set<string> {
  if (activeCommandIndex === undefined) {
    return new Set()
  }
  const path: string[] = []
  const holds = (level: readonly TraceActionChild[]): boolean =>
    level.some((child) => {
      if (!('group' in child) && child.commandIndex === activeCommandIndex) {
        return true
      }
      path.push(nodeKey(child))
      if (holds(childrenOf(child))) {
        return true
      }
      path.pop()
      return false
    })
  return holds(children) ? new Set(path) : new Set()
}

/** Groups open by default when failed or when holding the active command. */
export function defaultExpanded(
  group: TraceActionGroupNode,
  activeAncestors: ReadonlySet<string>
): boolean {
  return Boolean(group.failed) || activeAncestors.has(nodeKey({ group }))
}

/** A row that issued others opens by default when it failed (and no passing wait retried past it) or one of its rows is the active command. */
export function defaultCommandExpanded(
  node: TraceActionCommandNode,
  commands: readonly CommandLog[],
  activeAncestors: ReadonlySet<string>,
  retried: ReadonlySet<CommandLog> = new Set()
): boolean {
  const command = commands[node.commandIndex]
  return (
    (Boolean(command?.error) && !retried.has(command)) ||
    activeAncestors.has(nodeKey(node))
  )
}

/** Flatten the tree into render rows, descending only into expanded nodes. */
export function flattenActionTree(
  children: TraceActionChild[],
  isExpanded: (node: TraceActionChild) => boolean,
  depth = 0
): ActionTreeRow[] {
  const rows: ActionTreeRow[] = []
  for (const child of children) {
    const nested = childrenOf(child)
    const expanded =
      ('group' in child || nested.length > 0) && isExpanded(child)
    if ('group' in child) {
      rows.push({ kind: 'group', group: child.group, depth, expanded })
    } else {
      rows.push({
        kind: 'command',
        commandIndex: child.commandIndex,
        depth,
        ...(nested.length ? { expanded } : {})
      })
    }
    if (expanded) {
      rows.push(...flattenActionTree(nested, isExpanded, depth + 1))
    }
  }
  return rows
}
