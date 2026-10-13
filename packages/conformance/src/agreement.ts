import { gapsFor } from './allowlist.js'
import { RULES } from './constants.js'
import { normalizeRun, pathOf } from './normalize.js'
import type {
  AdapterId,
  Divergence,
  NormalizedRun,
  NormalizedStep,
  RuleId,
  RunReport,
  Violation
} from './types.js'

type Add = (rule: RuleId, message: string, step?: number) => void

/** Every adapter compared against the first, within one mode: no per-behaviour rule is needed to spot a difference. */
export function compareRuns(runs: RunReport[]): Divergence[] {
  const [reference, ...others] = [...runs].sort((a, b) =>
    a.adapter.localeCompare(b.adapter)
  )
  if (!reference) {
    return []
  }
  const ref = normalizeRun(reference.frames)
  return others.flatMap((other) =>
    compareTwo(
      [reference.adapter, other.adapter],
      ref,
      normalizeRun(other.frames)
    )
  )
}

function compareTwo(
  adapters: [AdapterId, AdapterId],
  a: NormalizedRun,
  b: NormalizedRun
): Divergence[] {
  const out: Divergence[] = []
  const add: Add = (rule, message, step) =>
    out.push({
      rule,
      adapters,
      step,
      message: `${adapters.join(' vs ')}: ${message}`
    })
  const actionsOf = (r: NormalizedRun) =>
    r.steps.map((s) => `${s.action} ${s.target}`)
  const firstDiff = firstDifference(actionsOf(a), actionsOf(b))
  if (firstDiff !== undefined) {
    add(
      RULES.agreeOnActions,
      describeAt(firstDiff, actionsOf(a), actionsOf(b)),
      firstDiff
    )
  }
  const aligned = Math.min(firstDiff ?? a.steps.length, b.steps.length)
  for (let i = 0; i < aligned; i++) {
    compareStep(i, a.steps[i], b.steps[i], add)
  }
  if (firstDifference(a.snapshots, b.snapshots) !== undefined) {
    add(
      RULES.agreeOnSnapshots,
      `snapshots [${a.snapshots.join(', ')}] vs [${b.snapshots.join(', ')}]`
    )
  }
  if (a.runControls !== b.runControls) {
    add(RULES.agreeOnRunControls, `${a.runControls} vs ${b.runControls}`)
  }
  return out
}

function compareStep(
  i: number,
  a: NormalizedStep,
  b: NormalizedStep,
  add: Add
): void {
  const where = `step ${i + 1} (${a.action} ${a.target})`
  if (a.input !== b.input) {
    add(
      RULES.agreeOnActions,
      `${where} types ${JSON.stringify(a.input)} vs ${JSON.stringify(b.input)}`,
      i
    )
  }
  if (a.outcome !== b.outcome) {
    add(RULES.agreeOnErrors, `${where}: ${a.outcome} vs ${b.outcome}`, i)
  }
  if (a.page !== b.page) {
    add(RULES.agreeOnPages, `${where} shows ${a.page} vs ${b.page}`, i)
  }
}

function firstDifference(a: string[], b: string[]): number | undefined {
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    if (a[i] !== b[i]) {
      return i
    }
  }
  return undefined
}

function describeAt(i: number, a: string[], b: string[]): string {
  return `step ${i + 1} is ${a[i] ?? '(nothing)'} vs ${b[i] ?? '(nothing)'} (${a.length} vs ${b.length} steps)`
}

/** A divergence is explained only by a gap occurring on that very subject, with the other adapter clean there. */
export function judgeDivergences(
  divergences: Divergence[],
  runs: RunReport[]
): { unexplained: Divergence[]; explained: Divergence[] } {
  const readable = runs.filter((r) => !r.checkerError)
  const normalized = new Map(
    readable.map((r) => [r.adapter, normalizeRun(r.frames)] as const)
  )
  const explainedBy = (d: Divergence) =>
    d.adapters.some((holder) => {
      const run = readable.find((r) => r.adapter === holder)
      const other = readable.find(
        (r) => r.adapter === d.adapters.find((id) => id !== holder)
      )
      return run && other ? gapExplains(d, run, other, normalized) : false
    })
  return {
    unexplained: divergences.filter((d) => !explainedBy(d)),
    explained: divergences.filter(explainedBy)
  }
}

// The holder's gap must show on the same step or document, or a second bug in the other adapter would hide behind it.
function gapExplains(
  d: Divergence,
  holder: RunReport,
  other: RunReport,
  normalized: Map<AdapterId, NormalizedRun>
): boolean {
  const gapRules = new Set(
    gapsFor(holder.adapter, holder.bidi)
      .filter((g) => g.rules.includes(d.rule))
      .flatMap((g) => g.rules)
  )
  const shown = holder.violations.filter((v) => gapRules.has(v.rule))
  if (!shown.length) {
    return false
  }
  const step = d.step
  if (d.rule === RULES.agreeOnPages && step !== undefined) {
    const at = (run: RunReport) => normalized.get(run.adapter)?.steps[step]?.at
    return (
      shown.some((v) => onRow(v, at(holder))) &&
      !other.violations.some((v) => onRow(v, at(other)))
    )
  }
  if (d.rule === RULES.agreeOnSnapshots) {
    const unanchored = shown
      .filter((v) => v.rule === RULES.documentAnchored)
      .flatMap((v) => (v.subject?.url ? [pathOf(v.subject.url)] : []))
    const holderPages = [
      ...(normalized.get(holder.adapter)?.snapshots ?? []),
      ...unanchored
    ].sort()
    const otherPages = [
      ...(normalized.get(other.adapter)?.snapshots ?? [])
    ].sort()
    return (
      sameList(holderPages, otherPages) &&
      !other.violations.some((v) => v.subject?.kind === 'document')
    )
  }
  return true
}

const onRow = (v: Violation, at: number | undefined) =>
  at !== undefined && v.subject?.kind === 'row' && v.subject.timestamp === at

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i])
