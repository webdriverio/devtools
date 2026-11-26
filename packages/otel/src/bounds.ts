import type { TraceActionChild } from '@wdio/devtools-shared'
import type { ManifestTest } from './manifest.js'
import { actionStart, type ActionInfo, type Bounds } from './prepared.js'

function actionBounds(action: ActionInfo): Bounds {
  return {
    startMs: actionStart(action.command),
    endMs: Math.max(action.command.timestamp, actionStart(action.command))
  }
}

function groupBounds(children: TraceActionChild[]): Bounds[] {
  return children.flatMap((child) =>
    'group' in child
      ? [
          { startMs: child.group.startTime, endMs: child.group.endTime },
          ...groupBounds(child.group.children)
        ]
      : []
  )
}

export function bounds(
  actions: ActionInfo[],
  groups: TraceActionChild[],
  fallbackMs: number
): Bounds {
  const spans = [...actions.map(actionBounds), ...groupBounds(groups)]
  if (!spans.length) {
    return { startMs: fallbackMs, endMs: fallbackMs }
  }
  return {
    startMs: Math.min(...spans.map((span) => span.startMs)),
    endMs: Math.max(...spans.map((span) => span.endMs))
  }
}

function union(a: Bounds, b: Bounds): Bounds {
  return {
    startMs: Math.min(a.startMs, b.startMs),
    endMs: Math.max(a.endMs, b.endMs)
  }
}

/** The test's own timing, for a manifest that predates `attempts`. */
export function testBounds(test: ManifestTest): Bounds | undefined {
  const endMs =
    test.endTime ??
    (test.startTime !== undefined && test.durationMs !== undefined
      ? test.startTime + test.durationMs
      : undefined)
  if (endMs === undefined) {
    return undefined
  }
  return {
    startMs:
      test.startTime ??
      (test.durationMs !== undefined ? endMs - test.durationMs : endMs),
    endMs
  }
}

/** A root covers its own timing and every action under it, so children never fall outside. */
export function rootBounds(
  timing: Bounds | undefined,
  span: Bounds | undefined,
  fallbackMs: number
): Bounds {
  const base = timing ?? span ?? { startMs: fallbackMs, endMs: fallbackMs }
  return timing && span ? union(timing, span) : base
}
