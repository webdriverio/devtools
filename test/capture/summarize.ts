// Reduces a reconstructed trace to a deterministic capture summary — the value
// that gets snapshotted per adapter. Everything here must be stable across runs
// (no timestamps, ids, counts that drift, or absolute paths), so the snapshot
// only changes when capture behaviour actually changes.
//
// The command vocabulary (the sorted set of distinct command names) is the
// sharp signal, and deliberately carries assertions too: each framework names
// them differently and inconsistently — WebdriverIO `toExist`/`toHaveText`
// (no result payload), Selenium `assert.*` (payload only on failure), Nightwatch
// `titleContains` (with a `passed` flag) — so there is no clean cross-adapter
// predicate for "is an assertion". The vocabulary sidesteps that: if an adapter
// stops emitting its assertion (or any) rows, that name vanishes from the set
// and the snapshot diff names it. No per-framework heuristic required.

import type {
  TraceActionChild,
  TracePlayerData
} from '../../packages/shared/src/trace-player.js'

export interface CaptureSummary {
  /** Sorted distinct command names captured — actions AND assertions. */
  commandVocabulary: string[]
  hasNetwork: boolean
  hasConsole: boolean
  hasMutations: boolean
  hasSources: boolean
  hasTranscript: boolean
  hasFrames: boolean
  /** Structural shape of the group tree (no titles — those carry run data). */
  groups: { topLevel: number; maxDepth: number }
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
  const roots = data.groups ?? []

  return {
    commandVocabulary: [
      ...new Set(trace.commands.map((c) => c.command))
    ].sort(),
    hasNetwork: trace.networkRequests.length > 0,
    hasConsole: trace.consoleLogs.length > 0,
    hasMutations: trace.mutations.length > 0,
    hasSources: Object.keys(trace.sources).length > 0,
    hasTranscript:
      typeof data.transcript === 'string' && data.transcript.length > 0,
    hasFrames: data.frames.length > 0,
    groups: {
      topLevel: roots.filter((child) => 'group' in child).length,
      maxDepth: Math.max(0, ...roots.map(groupDepth))
    }
  }
}
