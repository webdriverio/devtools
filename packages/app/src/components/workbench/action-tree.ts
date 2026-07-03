// Pure helpers behind the player's collapsible action tree: flattening the
// group tree into render rows and deciding which groups start expanded.

import type {
  TraceActionChild,
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
}

export type ActionTreeRow = GroupRow | CommandRow

/** Command indices anywhere under a group, nested groups included. */
export function collectCommandIndices(group: TraceActionGroupNode): number[] {
  const indices: number[] = []
  for (const child of group.children) {
    if ('group' in child) {
      indices.push(...collectCommandIndices(child.group))
    } else {
      indices.push(child.commandIndex)
    }
  }
  return indices
}

/** Groups open by default when failed or when holding the active command. */
export function defaultExpanded(
  group: TraceActionGroupNode,
  activeCommandIndex?: number
): boolean {
  if (group.failed) {
    return true
  }
  return (
    activeCommandIndex !== undefined &&
    collectCommandIndices(group).includes(activeCommandIndex)
  )
}

/** Flatten the tree into render rows, descending only into expanded groups. */
export function flattenActionTree(
  children: TraceActionChild[],
  isExpanded: (group: TraceActionGroupNode) => boolean,
  depth = 0
): ActionTreeRow[] {
  const rows: ActionTreeRow[] = []
  for (const child of children) {
    if ('group' in child) {
      const expanded = isExpanded(child.group)
      rows.push({ kind: 'group', group: child.group, depth, expanded })
      if (expanded) {
        rows.push(
          ...flattenActionTree(child.group.children, isExpanded, depth + 1)
        )
      }
    } else {
      rows.push({ kind: 'command', commandIndex: child.commandIndex, depth })
    }
  }
  return rows
}
