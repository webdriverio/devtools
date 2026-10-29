import type { CommandLog } from './types.js'

/** A row and the rows its execution issued, each level in list order. */
export interface CommandNode<T extends CommandLog = CommandLog> {
  command: T
  children: CommandNode<T>[]
}

/**
 * Nests a flat row list under each row's `parentId`. A row whose parent is not in the list stays at the top level, so a
 * list rebuilt on every update re-nests it once the parent arrives; a row whose ancestry loops back to itself is a root.
 */
export function nestCommands<T extends CommandLog>(
  commands: readonly T[]
): CommandNode<T>[] {
  const nodes = commands.map((command) => ({
    command,
    children: [] as CommandNode<T>[]
  }))
  const byId = new Map<number, CommandNode<T>>()
  for (const node of nodes) {
    const { id } = node.command
    if (typeof id === 'number' && !byId.has(id)) {
      byId.set(id, node)
    }
  }
  const parentOf = (node: CommandNode<T>) => {
    const { parentId } = node.command
    return typeof parentId === 'number' ? byId.get(parentId) : undefined
  }
  const roots: CommandNode<T>[] = []
  for (const node of nodes) {
    const parent = parentOf(node)
    if (parent && !closesCycle(node, parentOf)) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

function closesCycle<T extends CommandLog>(
  node: CommandNode<T>,
  parentOf: (node: CommandNode<T>) => CommandNode<T> | undefined
): boolean {
  const seen = new Set<CommandNode<T>>()
  for (let at = parentOf(node); at && !seen.has(at); at = parentOf(at)) {
    if (at === node) {
      return true
    }
    seen.add(at)
  }
  return false
}
