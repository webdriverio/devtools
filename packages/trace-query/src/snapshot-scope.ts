import { parseSnapshotLine, type SnapshotLine } from '@wdio/devtools-shared'
import type { SnapshotScope } from './types.js'

interface NodeLine {
  line: string
  node: SnapshotLine
}

/** A snapshot's node lines, narrowed to a scope, with how many subtrees it matched when one was named. */
interface ScopedSnapshot {
  lines: string[]
  matches?: number
}

function matcherOf(scope: SnapshotScope): (node: SnapshotLine) => boolean {
  const text = scope.text?.toLowerCase()
  return (node) =>
    (scope.locator === undefined || node.selector === scope.locator) &&
    (text === undefined ||
      [node.role, node.name, node.purpose ?? ''].some((field) =>
        field.toLowerCase().includes(text)
      ))
}

/** Each matching node with every line below it, the lines up to the next one no deeper; a match inside a kept subtree is part of it. */
function subtrees(
  nodes: readonly NodeLine[],
  matches: (node: SnapshotLine) => boolean
): { kept: NodeLine[]; matches: number } {
  const kept: NodeLine[] = []
  let roots = 0
  let rootDepth: number | undefined
  for (const entry of nodes) {
    if (rootDepth !== undefined && entry.node.depth > rootDepth) {
      kept.push(entry)
      continue
    }
    rootDepth = undefined
    if (matches(entry.node)) {
      roots++
      rootDepth = entry.node.depth
      kept.push(entry)
    }
  }
  return { kept, matches: roots }
}

// The serializers indent by document depth, so a page's top nodes can sit eight spaces in; every space is paid for.
function dedent(lines: readonly string[]): string[] {
  const indent = lines.reduce(
    (least, line) => Math.min(least, line.length - line.trimStart().length),
    Infinity
  )
  return lines.map((line) => line.slice(indent))
}

/** The node lines of a snapshot's text, the header and blank lines left out, narrowed to the scope when it names one. */
export function scopeSnapshot(
  text: string,
  scope: SnapshotScope
): ScopedSnapshot {
  const nodes = text.split('\n').flatMap((line) => {
    const node = parseSnapshotLine(line)
    return node ? [{ line, node }] : []
  })
  if (scope.locator === undefined && scope.text === undefined) {
    return { lines: dedent(nodes.map(({ line }) => line)) }
  }
  const { kept, matches } = subtrees(nodes, matcherOf(scope))
  return { lines: dedent(kept.map(({ line }) => line)), matches }
}
