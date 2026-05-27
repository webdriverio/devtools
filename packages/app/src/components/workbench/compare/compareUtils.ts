import type { CommandLog } from '@wdio/devtools-service/types'

export interface ComparePairedStep {
  index: number
  baseline?: CommandLog
  latest?: CommandLog
  divergent: boolean
}

/**
 * Pair commands by index. Once a divergent pair is encountered, every
 * subsequent index is also marked divergent (mirrors how Playwright
 * thinks about trace alignment — once execution forks, downstream
 * comparison is meaningless).
 */
export function pairSteps(
  baseline: CommandLog[] = [],
  latest: CommandLog[] = []
): ComparePairedStep[] {
  const len = Math.max(baseline.length, latest.length)
  const out: ComparePairedStep[] = []
  let forked = false
  for (let i = 0; i < len; i++) {
    const b = baseline[i]
    const l = latest[i]
    const divergent = forked || !commandsEqual(b, l)
    if (divergent) {
      forked = true
    }
    out.push({ index: i, baseline: b, latest: l, divergent })
  }
  return out
}

export function commandsEqual(
  a: CommandLog | undefined,
  b: CommandLog | undefined
): boolean {
  if (!a || !b) {
    return false
  }
  if (a.command !== b.command) {
    return false
  }
  if (stableStringify(a.args) !== stableStringify(b.args)) {
    return false
  }
  // Outcome diff: error presence/message difference is a divergence.
  // We intentionally do NOT compare `result` here — WebDriver element refs
  // (`{"element-6066-11e4-a52e-4f735466cecf": "..."}` from $() / $$()) get
  // a fresh ID every browser session, so comparing raw results would mark
  // every selector call as divergent. Result divergence as a signal for
  // assertion failure is handled instead by step-level pass/fail markers.
  const aErr = a.error ? a.error.message || String(a.error) : ''
  const bErr = b.error ? b.error.message || String(b.error) : ''
  if (aErr !== bErr) {
    return false
  }
  return true
}

/**
 * Classify the nature of a pair's divergence so the UI can render different
 * cues for each. `none` = identical; `command` = different command/args (a
 * fork in execution); `error` = WebDriver-level error on one side only;
 * `missing` = one side has the step and the other doesn't.
 */
export type DivergenceKind = 'none' | 'command' | 'error' | 'missing'

export function classifyDivergence(
  a: CommandLog | undefined,
  b: CommandLog | undefined
): DivergenceKind {
  if (!a || !b) {
    return a || b ? 'missing' : 'none'
  }
  if (a.command !== b.command) {
    return 'command'
  }
  if (stableStringify(a.args) !== stableStringify(b.args)) {
    return 'command'
  }
  const aErr = a.error ? a.error.message || String(a.error) : ''
  const bErr = b.error ? b.error.message || String(b.error) : ''
  if (aErr !== bErr) {
    return 'error'
  }
  return 'none'
}

export function firstDivergentIndex(pairs: ComparePairedStep[]): number {
  return pairs.findIndex((p) => p.divergent)
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value, sortedReplacer)
  } catch {
    return String(value)
  }
}

function sortedReplacer(_key: string, value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k]
    }
    return sorted
  }
  return value
}
