// Pure helpers behind the flat (live) actions list: document loads and
// commands in time order, with the rows a command issued (a wait's reads)
// nested under it and shown only while it is expanded.

import {
  commandDescendants,
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

/** A command that issued others opens by default when it failed or holds the active entry. */
export function defaultLiveExpanded(
  node: CommandNode,
  active?: TimelineEntry
): boolean {
  if (node.command.error) {
    return true
  }
  return (
    active !== undefined &&
    (commandDescendants(node) as TimelineEntry[]).includes(active)
  )
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
