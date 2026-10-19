import { explainingGap, gapsFor, isAgreementRule } from './allowlist.js'
import { RULES } from './constants.js'
import { describeRunControls, normalizeRun, pathOf } from './normalize.js'
import type {
  AdapterId,
  Divergence,
  KnownGap,
  NormalizedRun,
  NormalizedStep,
  RuleId,
  RunControls,
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
  if (!sameRunControls(a.runControls, b.runControls)) {
    add(
      RULES.agreeOnRunControls,
      `${describeRunControls(a.runControls)} vs ${describeRunControls(b.runControls)}`
    )
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

/** A divergence is explained only by a gap occurring on that very subject, unless the other side declares its own. */
export function judgeDivergences(
  divergences: Divergence[],
  runs: RunReport[]
): { unexplained: Divergence[]; explained: Divergence[]; stale: KnownGap[] } {
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
  // A gap whose comparison rules matched no difference no longer holds, which judge() cannot see.
  const stale = readable.flatMap((run) =>
    gapsFor(run.adapter, run.bidi).filter((g) => {
      const own = g.rules.filter(isAgreementRule)
      return (
        !g.timingDependent &&
        own.length > 0 &&
        !divergences.some(
          (d) => d.adapters.includes(run.adapter) && own.includes(d.rule)
        )
      )
    })
  )
  return {
    unexplained: divergences.filter((d) => !explainedBy(d)),
    explained: divergences.filter(explainedBy),
    stale
  }
}

// The holder's gap must show on the same step or document, or a second bug in the other adapter would hide behind it.
function gapExplains(
  d: Divergence,
  holder: RunReport,
  other: RunReport,
  normalized: Map<AdapterId, NormalizedRun>
): boolean {
  const gaps = gapsFor(holder.adapter, holder.bidi).filter((g) =>
    g.rules.includes(d.rule)
  )
  if (!gaps.length) {
    return false
  }
  const gapRules = new Set(gaps.flatMap((g) => g.rules))
  const shown = holder.violations.filter((v) => gapRules.has(v.rule))
  const step = d.step
  if (d.rule === RULES.agreeOnPages && step !== undefined) {
    const at = (run: RunReport) => normalized.get(run.adapter)?.steps[step]?.at
    return (
      shown.some((v) => onRow(v, at(holder))) &&
      !other.violations.some((v) => onRow(v, at(other)) && !declared(other, v))
    )
  }
  if (d.rule === RULES.agreeOnSnapshots) {
    // Each side's snapshots plus the documents its own declared gap left unanchored must agree.
    const pages = (run: RunReport, violations: Violation[]) =>
      [
        ...(normalized.get(run.adapter)?.snapshots ?? []),
        ...violations
          .filter((v) => v.rule === RULES.documentAnchored && v.subject?.url)
          .map((v) => pathOf(v.subject!.url!))
      ].sort()
    const otherDeclared = other.violations.filter((v) => declared(other, v))
    return (
      sameList(pages(holder, shown), pages(other, otherDeclared)) &&
      !other.violations.some(
        (v) => v.subject?.kind === 'document' && !declared(other, v)
      )
    )
  }
  if (d.rule === RULES.agreeOnRunControls) {
    return runControlsExplained(
      gaps,
      normalized.get(holder.adapter),
      normalized.get(other.adapter)
    )
  }
  // A rule with no per-run counterpart (actions, errors): the difference is the gap.
  return true
}

// The gap explains the absence of the controls it declares and nothing else, so a control lost since is a finding.
function runControlsExplained(
  gaps: KnownGap[],
  holder: NormalizedRun | undefined,
  other: NormalizedRun | undefined
): boolean {
  if (!holder || !other) {
    return false
  }
  const lacks = new Set<string>(gaps.flatMap((g) => g.lacksRunControls ?? []))
  return sameRunControls(holder.runControls, {
    ...other.runControls,
    advertised: other.runControls.advertised.filter((c) => !lacks.has(c))
  })
}

const sameRunControls = (a: RunControls, b: RunControls) =>
  a.served === b.served && sameList(a.advertised, b.advertised)

const declared = (run: RunReport, v: Violation) =>
  Boolean(explainingGap(gapsFor(run.adapter, run.bidi), v))

const onRow = (v: Violation, at: number | undefined) =>
  at !== undefined && v.subject?.kind === 'row' && v.subject.timestamp === at

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i])
