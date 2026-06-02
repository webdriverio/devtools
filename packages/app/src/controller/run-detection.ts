import { getTimestamp } from '../utils/helpers.js'
import type { SuiteStatsFragment } from './types.js'

type SuiteChunks = Array<Record<string, SuiteStatsFragment>>

export interface RunDetectionState {
  /** Highest start-timestamp seen so far across any incoming suite. */
  lastSeenRunTimestamp: number
  /** Active feature/scenario rerun (set by clearExecutionData). Presence
   *  suppresses new-run auto-detection so sibling updates don't wipe data. */
  activeRerunSuiteUid: string | undefined
}

export interface RunDetectionResult {
  /** True if the incoming payload signals a fresh test run — caller should
   *  reset the execution-data context providers. */
  shouldReset: boolean
  /** Updated `lastSeenRunTimestamp` value the caller should write back. */
  newLastSeenTimestamp: number
}

/**
 * Decide whether an incoming `suites` payload represents a new run that
 * should wipe accumulated execution data.
 *
 * Rules (in order):
 *  1. If a UI-triggered rerun is active (`activeRerunSuiteUid` set), never
 *     auto-reset — siblings under the same feature would lose state. The
 *     timestamp tracker still advances so the post-rerun final update isn't
 *     mistakenly treated as a new run.
 *  2. If we see a suite whose start-timestamp is newer than anything
 *     previously seen AND the existing suite for that uid is finished
 *     (has an `end`), it's a brand-new run → reset.
 *  3. If the existing suite has no `end`, it's an ongoing run (e.g. a
 *     cucumber feature spanning multiple scenarios) — continuation, no reset.
 *
 * Pure: no `this`. Pass state in, write the returned timestamp back.
 */
// During a known rerun: just advance the lastSeen high-water mark and don't
// signal a reset — we'd otherwise wipe the rerun's own freshly-written tree.
function advanceLastSeenAcrossPayloads(
  payloads: Record<string, SuiteStatsFragment>[],
  lastSeen: number
): number {
  for (const chunk of payloads) {
    if (!chunk) {
      continue
    }
    for (const suite of Object.values(chunk)) {
      if (!suite?.start) {
        continue
      }
      const t = getTimestamp(suite.start as Date | number | string | undefined)
      if (t > lastSeen) {
        lastSeen = t
      }
    }
  }
  return lastSeen
}

function lookupExistingSuiteEnd(
  chunk: Record<string, SuiteStatsFragment>,
  existingChunks: SuiteChunks
): unknown {
  const firstUid = Object.keys(chunk)[0]
  for (const ec of existingChunks) {
    for (const [uid, existing] of Object.entries(ec)) {
      if (uid === firstUid) {
        return existing?.end
      }
    }
  }
  return undefined
}

export function shouldResetForNewRun(
  data: unknown,
  state: RunDetectionState,
  existingChunks: SuiteChunks
): RunDetectionResult {
  let lastSeen = state.lastSeenRunTimestamp
  const payloads = Array.isArray(data)
    ? (data as Record<string, SuiteStatsFragment>[])
    : ([data] as Record<string, SuiteStatsFragment>[])

  if (state.activeRerunSuiteUid) {
    lastSeen = advanceLastSeenAcrossPayloads(payloads, lastSeen)
    return { shouldReset: false, newLastSeenTimestamp: lastSeen }
  }

  for (const chunk of payloads) {
    if (!chunk) {
      continue
    }
    for (const suite of Object.values(chunk)) {
      if (!suite?.start) {
        continue
      }
      const suiteStartTime = getTimestamp(
        suite.start as Date | number | string | undefined
      )
      if (suiteStartTime <= 0 || suiteStartTime <= lastSeen) {
        continue
      }
      const existingEnd = lookupExistingSuiteEnd(chunk, existingChunks)
      const previousRunFinished =
        existingEnd !== null && existingEnd !== undefined
      if (previousRunFinished) {
        return { shouldReset: true, newLastSeenTimestamp: suiteStartTime }
      }
      // Continuation — advance high-water mark, don't reset.
      lastSeen = suiteStartTime
    }
  }
  return { shouldReset: false, newLastSeenTimestamp: lastSeen }
}
