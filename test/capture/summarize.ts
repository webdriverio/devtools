// Reduces a reconstructed trace to a deterministic capture summary — the value
// that gets snapshotted per adapter. Everything here must be stable across runs
// (no timestamps, ids, counts that drift, or absolute paths), so the snapshot
// only changes when capture behaviour actually changes.
//
// The command vocabulary (the sorted set of distinct command names) is the
// sharp signal: if an adapter stops emitting `expect.*` / `assert.*` rows, that
// name vanishes from the set and the snapshot diff names it.

import type {
  TraceActionChild,
  TracePlayerData
} from '../../packages/shared/src/trace-player.js'
import type { CommandLog } from '../../packages/shared/src/types.js'

export interface CaptureSummary {
  /** Sorted distinct command names captured (the "vocabulary"). */
  commandVocabulary: string[]
  hasAssertions: boolean
  assertionsCarryExpectedActual: boolean
  hasNetwork: boolean
  hasConsole: boolean
  hasMutations: boolean
  hasSources: boolean
  hasActionSnapshots: boolean
  hasTranscript: boolean
  hasFrames: boolean
  /** Structural shape of the group tree (no titles — those carry run data). */
  groups: { topLevel: number; maxDepth: number }
}

function isAssertion(command: CommandLog): boolean {
  return (
    command.command.startsWith('assert') || command.command.startsWith('expect')
  )
}

function hasExpectedActual(result: unknown): boolean {
  return (
    typeof result === 'object' &&
    result !== null &&
    ('expected' in result || 'actual' in result)
  )
}

function groupDepth(child: TraceActionChild): number {
  if ('group' in child) {
    const children = child.group.children ?? []
    return 1 + Math.max(0, ...children.map(groupDepth))
  }
  return 0
}

export function summarizeCapture(data: TracePlayerData): CaptureSummary {
  const trace = data.trace
  const asserts = trace.commands.filter(isAssertion)
  const roots = data.groups ?? []

  return {
    commandVocabulary: [
      ...new Set(trace.commands.map((c) => c.command))
    ].sort(),
    hasAssertions: asserts.length > 0,
    assertionsCarryExpectedActual: asserts.some((c) =>
      hasExpectedActual(c.result)
    ),
    hasNetwork: trace.networkRequests.length > 0,
    hasConsole: trace.consoleLogs.length > 0,
    hasMutations: trace.mutations.length > 0,
    hasSources: Object.keys(trace.sources).length > 0,
    hasActionSnapshots: (trace.actionSnapshots ?? []).length > 0,
    hasTranscript:
      typeof data.transcript === 'string' && data.transcript.length > 0,
    hasFrames: data.frames.length > 0,
    groups: {
      topLevel: roots.filter((child) => 'group' in child).length,
      maxDepth: Math.max(0, ...roots.map(groupDepth))
    }
  }
}
