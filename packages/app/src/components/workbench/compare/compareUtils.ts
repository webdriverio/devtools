import type { CommandLog } from '@wdio/devtools-service/types'

export interface ComparePairedStep {
  index: number
  baseline?: CommandLog
  latest?: CommandLog
  divergent: boolean
}

export type DivergenceKind =
  | 'none'
  | 'commandName'
  | 'args'
  | 'error'
  | 'missing'

/** Pair commands by index. Once a real divergence is detected the fork bit
 *  sticks — downstream rows are also marked divergent. */
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
  // Skip `result` comparison: W3C element refs get a fresh id each session.
  const aErr = a.error ? a.error.message || String(a.error) : ''
  const bErr = b.error ? b.error.message || String(b.error) : ''
  return aErr === bErr
}

export function classifyDivergence(
  a: CommandLog | undefined,
  b: CommandLog | undefined
): DivergenceKind {
  if (!a || !b) {
    return a || b ? 'missing' : 'none'
  }
  if (a.command !== b.command) {
    return 'commandName'
  }
  if (stableStringify(a.args) !== stableStringify(b.args)) {
    return 'args'
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

const MAX_JSON_LEN = 500

export function safeJson(value: unknown): string {
  try {
    const s = JSON.stringify(value)
    if (!s) {
      return String(value)
    }
    return s.length > MAX_JSON_LEN ? s.slice(0, MAX_JSON_LEN) + '…' : s
  } catch {
    return String(value)
  }
}

/** Strip ANSI escapes and collapse blank-line runs so the error banner
 *  doesn't grow tall from formatting whitespace. */
export function cleanErrorMessage(msg: string): string {
  return msg
    .replace(/\[[0-9;]*m/g, '')
    .replace(/\[\d+m/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const STEP_VERB_RE =
  /^(?:I should see|should see|should have|should be|should contain|should equal|should match|see|have|equals?|matches?|contains?)\s+(?:a\s+)?(?:flash\s+message\s+saying\s+|text\s+|message\s+saying\s+|message\s+|value\s+)?(.+)$/i

/** Best-effort extraction of the expected value from a Cucumber step title
 *  (strip the keyword + common verb phrase, return the parameterized tail). */
export function extractExpectedFromStepText(
  stepText: string
): string | undefined {
  if (!stepText) {
    return undefined
  }
  const stripped = stepText
    .replace(/^\d+:\s*/, '')
    .replace(/^(Given|When|Then|And|But)\s+/i, '')
    .trim()
  const m = stripped.match(STEP_VERB_RE)
  if (m && m[1]) {
    return m[1].trim()
  }
  return stripped || undefined
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
