import { gapsFor } from './allowlist.js'
import { RULES } from './constants.js'
import { normalizeRun } from './normalize.js'
import type {
  AdapterId,
  Divergence,
  NormalizedRun,
  NormalizedStep,
  RuleId,
  RunReport
} from './types.js'

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
  const add = (rule: RuleId, message: string) =>
    out.push({
      rule,
      adapters,
      message: `${adapters.join(' vs ')}: ${message}`
    })
  const actionsOf = (r: NormalizedRun) =>
    r.steps.map((s) => `${s.action} ${s.target}`)
  const firstDiff = firstDifference(actionsOf(a), actionsOf(b))
  if (firstDiff !== undefined) {
    add(RULES.agreeOnActions, describeAt(firstDiff, actionsOf(a), actionsOf(b)))
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
  add: (rule: RuleId, message: string) => void
): void {
  const where = `step ${i + 1} (${a.action} ${a.target})`
  if (a.outcome !== b.outcome) {
    add(RULES.agreeOnErrors, `${where}: ${a.outcome} vs ${b.outcome}`)
  }
  if (a.page !== b.page) {
    add(RULES.agreeOnPages, `${where} shows ${a.page} vs ${b.page}`)
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

/** A divergence is explained when either adapter declares a gap for it in this mode. */
export function judgeDivergences(
  divergences: Divergence[],
  runs: RunReport[]
): { unexplained: Divergence[]; explained: Divergence[] } {
  // A gap excuses a difference only while it is occurring, i.e. its holder's own run shows it.
  const occurring = (id: AdapterId) => {
    const run = runs.find((r) => r.adapter === id)
    return run
      ? gapsFor(id, run.bidi).filter((g) =>
          run.violations.some((v) => g.rules.includes(v.rule))
        )
      : []
  }
  const explainedBy = (d: Divergence) =>
    d.adapters.some((id) => occurring(id).some((g) => g.rules.includes(d.rule)))
  return {
    unexplained: divergences.filter((d) => !explainedBy(d)),
    explained: divergences.filter(explainedBy)
  }
}
