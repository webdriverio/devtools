// Pure helpers behind the flat (live) actions list: document loads and
// commands in time order, with the rows a command issued (a wait's reads)
// nested under it and shown only while it is expanded.

import {
  nestCommands,
  type CommandLog,
  type CommandNode
} from '@wdio/devtools-shared'

export type TimelineEntry = TraceMutation | CommandLog

export interface LiveRow {
  entry: TimelineEntry
  depth: number
  /** Set on a row that issued others: whether they are rendered below it. */
  expanded?: boolean
  /** Toggle key of a row that issued others. */
  key?: string
}

/** Toggle key of a command that issued others; such a command always carries the `id` its rows name. */
export const liveRowKey = (command: CommandLog) => `live:${command.id}`

const byTime = (a: { entry: TimelineEntry }, b: { entry: TimelineEntry }) =>
  a.entry.timestamp - b.entry.timestamp

/** Only document loads (childList with a url) are rows; individual node add/remove mutations are too noisy. */
export function visibleMutations(mutations: readonly TraceMutation[]) {
  return mutations.filter((m) => m.type === 'childList' && Boolean(m.url))
}

/** Ids of every row above the active entry, walked up once per render so each row's default is a set lookup. */
export function activeAncestorIds(
  commands: readonly CommandLog[],
  active?: TimelineEntry
): Set<number> {
  const ancestors = new Set<number>()
  if (!active || !('command' in active)) {
    return ancestors
  }
  const byId = new Map<number, CommandLog>()
  for (const command of commands) {
    if (typeof command.id === 'number' && !byId.has(command.id)) {
      byId.set(command.id, command)
    }
  }
  const parentOf = (row: CommandLog) =>
    row.parentId === undefined ? undefined : byId.get(row.parentId)
  for (
    let parent = parentOf(active);
    parent && !ancestors.has(parent.id!);
    parent = parentOf(parent)
  ) {
    ancestors.add(parent.id!)
  }
  return ancestors
}

/** A command that issued others opens by default when it failed or holds the active entry. */
export function defaultLiveExpanded(
  node: CommandNode,
  activeAncestors: ReadonlySet<number>
): boolean {
  const { error, id } = node.command
  return Boolean(error) || (id !== undefined && activeAncestors.has(id))
}

/** The rows the list renders, each level in time order, descending only into expanded commands. */
export function liveActionRows(
  mutations: readonly TraceMutation[],
  commands: readonly CommandLog[],
  isExpanded: (node: CommandNode) => boolean
): LiveRow[] {
  const roots = [
    ...visibleMutations(mutations).map((entry) => ({ entry })),
    ...nestCommands(commands).map((node) => ({ entry: node.command, node }))
  ].sort(byTime)
  const rows: LiveRow[] = []
  const walk = (
    level: { entry: TimelineEntry; node?: CommandNode }[],
    depth: number
  ) => {
    for (const { entry, node } of level) {
      if (!node?.children.length) {
        rows.push({ entry, depth })
        continue
      }
      const expanded = isExpanded(node)
      rows.push({ entry, depth, expanded, key: liveRowKey(node.command) })
      if (expanded) {
        walk(
          node.children
            .map((child) => ({ entry: child.command, node: child }))
            .sort(byTime),
          depth + 1
        )
      }
    }
  }
  walk(roots, 0)
  return rows
}
