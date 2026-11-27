import {
  traceOutcome,
  type TraceActionChild,
  type TraceOutcome,
  type TracePlayerData
} from '@wdio/devtools-shared'

export interface TraceRunSummary {
  outcome: TraceOutcome
  /** The test the trace holds, outermost suite first; absent unless it holds exactly one. */
  titlePath?: string[]
  /** When the trace starts, which orders a run's traces as they ran. */
  startTime: number
}

// A per-test zip nests its test in one chain of groups, suites first, ending where a group holds actions or steps.
function singleTestPath(
  children: readonly TraceActionChild[]
): string[] | undefined {
  const path: string[] = []
  let level = children
  while (level.length === 1 && 'group' in level[0]) {
    path.push(level[0].group.title)
    level = level[0].group.children
  }
  return path.length ? path : undefined
}

export function summarizeTrace(data: TracePlayerData): TraceRunSummary {
  return {
    outcome: traceOutcome(data),
    titlePath: singleTestPath(data.groups ?? []),
    startTime: data.startTime
  }
}

const TRACE_FILE_STEM = 'trace'

/** A name for a zip from its path: its folder for a per-test `trace.zip`, its own name otherwise. */
export function traceLabelFromPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  const name = parts[parts.length - 1] ?? path
  const stem = name.replace(/\.zip$/i, '')
  const folder = parts[parts.length - 2]
  return stem.toLowerCase() === TRACE_FILE_STEM && folder ? folder : stem
}
