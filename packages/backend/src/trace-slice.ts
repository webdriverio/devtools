/**
 * Split an accumulated run into one slice per test.
 *
 * `core/spec-trace-helpers.ts` cannot be reused here. It slices by index ranges
 * the adapter snapshots at each test boundary — possible only in-process, where
 * the code that knows a test started is the same code holding the arrays. The
 * backend accumulates asynchronously and learns about boundaries from the suite
 * tree, after the fact.
 *
 * So the split is by content instead: commands carry `testUid`, and every other
 * stream is timestamped, so a test's window bounds them. That is the more robust
 * half of the trade — an index snapshot taken a moment late silently attributes
 * rows to the wrong test, whereas a window is wrong only where tests genuinely
 * overlap, which one driver in one process cannot do.
 */

import type { ActiveRun, TimeWindowNode } from './baseline/types.js'

/** One test's own view of the run. */
export interface RunSlice {
  uid: string
  title: string
  /** The node this came from, so retention reads the same state the tree has. */
  node: TimeWindowNode
  run: ActiveRun
}

/** Inclusive at both ends: a command stamped exactly at its test's start or end
 *  belongs to it, and the boundaries come from the same clock the rows do. */
function within(
  timestamp: number | undefined,
  start: number,
  end: number
): boolean {
  return timestamp !== undefined && timestamp >= start && timestamp <= end
}

/**
 * Every test that reported a usable window, in the order the tree lists them.
 *
 * A node missing `start` or `end` is skipped rather than given an open window:
 * an unbounded slice would swallow the whole run and be written once per test.
 */
export function sliceRunByTest(run: Readonly<ActiveRun>): RunSlice[] {
  const slices: RunSlice[] = []
  for (const node of run.nodes.values()) {
    if (node.kind !== 'test') {
      continue
    }
    const { start, end } = node
    if (start === undefined || end === undefined || end < start) {
      continue
    }
    // Commands are attributed rather than windowed: the adapter stamped which
    // test each one belongs to, which beats inferring it from a clock.
    const commands = run.commands.filter((cmd) => cmd.testUid === node.uid)
    slices.push({
      uid: node.uid,
      title: node.title ?? node.fullTitle ?? node.uid,
      node,
      run: {
        ...run,
        commands,
        consoleLogs: run.consoleLogs.filter((e) =>
          within(e.timestamp, start, end)
        ),
        networkRequests: run.networkRequests.filter((e) =>
          within(e.startTime ?? e.timestamp, start, end)
        ),
        mutations: run.mutations.filter((e) => within(e.timestamp, start, end)),
        actionSnapshots: run.actionSnapshots.filter((e) =>
          within(e.timestamp, start, end)
        ),
        screencastFrames: run.screencastFrames.filter((e) =>
          within(e.timestamp, start, end)
        ),
        // Shared, not sliced: the Source tab needs the file a command points at,
        // and a run's sources are small next to its frames.
        sources: run.sources,
        // Only this test, so the slice's own trace carries one group rather
        // than opening groups for tests whose rows are not in it.
        nodes: new Map([[node.uid, node]])
      }
    })
  }
  return slices
}
