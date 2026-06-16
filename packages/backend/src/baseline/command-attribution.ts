/**
 * Attribute captured commands to a test/suite node for Preserve & Rerun.
 *
 * Adapters can't always tag a command with the right `testUid` — Nightwatch's
 * before/after hooks fire once per spec file, so every test after the first in
 * a multi-test file inherits the first test's uid. Source location is reliable
 * instead: a command's call site (`callSource` line) sits inside exactly one
 * `it()` block. Commands issued indirectly (e.g. an assertion's internal
 * `getText`) have no resolvable call site and fall back to the node's time
 * window, which keeps them with the test they ran in.
 *
 * Pure functions over the accumulator's node map + command list, so the
 * attribution can be unit-tested without the store.
 */
import type { CommandLogLike, TimeWindowNode } from './types.js'

type SourceRange = { file: string; start: number; end: number }
type TimeWindow = { start: number; end: number }
type NodeMap = Map<string, TimeWindowNode>

/** Split a `callSource` (`file:line` or `file:line:col`) into file + line. */
export function lineOf(
  callSource?: string
): { file: string; line: number } | undefined {
  if (!callSource) {
    return undefined
  }
  const m = callSource.match(/:(\d+)(?::\d+)?$/)
  if (!m || m.index === undefined) {
    return undefined
  }
  return { file: callSource.slice(0, m.index), line: Number(m[1]) }
}

/** Sorted declaration lines of every test node in `file` — bounds each test's
 *  source range at the next test's line. */
function testLinesInFile(nodes: NodeMap, file: string): number[] {
  const lines = new Set<number>()
  for (const n of nodes.values()) {
    if (n.kind !== 'test') {
      continue
    }
    const loc = lineOf(n.callSource)
    if (loc && loc.file === file) {
      lines.add(loc.line)
    }
  }
  return [...lines].sort((a, b) => a - b)
}

/** Source range [it()-line, next-test-line) for a single test node. */
function rangeOf(
  node: TimeWindowNode,
  nodes: NodeMap
): SourceRange | undefined {
  const loc = lineOf(node.callSource)
  if (!loc) {
    return undefined
  }
  const next = testLinesInFile(nodes, loc.file).find((l) => l > loc.line)
  return {
    file: loc.file,
    start: loc.line,
    end: next ?? Number.POSITIVE_INFINITY
  }
}

/** Source ranges of every test node in a subtree (itself + descendants). */
function rangesForSubtree(node: TimeWindowNode, nodes: NodeMap): SourceRange[] {
  const ranges: SourceRange[] = []
  const visit = (n: TimeWindowNode) => {
    if (n.kind === 'test') {
      const r = rangeOf(n, nodes)
      if (r) {
        ranges.push(r)
      }
    }
    for (const childUid of n.childUids) {
      const child = nodes.get(childUid)
      if (child) {
        visit(child)
      }
    }
  }
  visit(node)
  return ranges
}

/** Source ranges of every test node in the run — used to tell when a command
 *  belongs to *some other* test (so it must be excluded from this node). */
function allTestRanges(nodes: NodeMap): SourceRange[] {
  const ranges: SourceRange[] = []
  for (const n of nodes.values()) {
    if (n.kind === 'test') {
      const r = rangeOf(n, nodes)
      if (r) {
        ranges.push(r)
      }
    }
  }
  return ranges
}

function inRanges(
  loc: { file: string; line: number } | undefined,
  ranges: SourceRange[]
): boolean {
  return (
    loc !== undefined &&
    ranges.some(
      (r) => r.file === loc.file && loc.line >= r.start && loc.line < r.end
    )
  )
}

/**
 * Commands belonging to `node`:
 *   - call site inside this test's source range → include;
 *   - call site inside a *different* test's range → exclude;
 *   - no resolvable call site (e.g. assertion-internal getText) → include when
 *     it falls in the node's time window.
 */
export function commandsForNode(
  node: TimeWindowNode,
  nodes: NodeMap,
  commands: CommandLogLike[],
  nodeWindow: TimeWindow | undefined
): CommandLogLike[] {
  const nodeRanges = rangesForSubtree(node, nodes)
  const allRanges = allTestRanges(nodes)
  const inWindow = (t: number | undefined) =>
    nodeWindow !== undefined &&
    t !== undefined &&
    t >= nodeWindow.start &&
    t <= nodeWindow.end
  return commands.filter((c) => {
    const loc = lineOf(c.callSource)
    if (inRanges(loc, nodeRanges)) {
      return true
    }
    if (inRanges(loc, allRanges)) {
      return false
    }
    return inWindow(c.timestamp)
  })
}
