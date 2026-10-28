import {
  covers,
  declaresLacks,
  explainingGap,
  gapsFor,
  isAgreementRule
} from './allowlist.js'
import { RULES } from './constants.js'
import {
  allSteps,
  describeRunControls,
  normalizeRun,
  pathOf
} from './normalize.js'
import {
  alignSteps,
  lacked,
  stepKey,
  testLabel,
  type Hunk
} from './step-alignment.js'
import type {
  AdapterId,
  Divergence,
  KnownGap,
  Lacks,
  Move,
  NormalizedRun,
  NormalizedStep,
  RuleId,
  RunControls,
  RunReport,
  Violation
} from './types.js'

type Add = (rule: RuleId, message: string, at?: Divergence['at']) => void

/** Every adapter compared against the first, within one mode: no per-behaviour rule is needed to spot a difference. */
export function compareRuns(runs: RunReport[]): Divergence[] {
  const [reference, ...others] = byAdapter(runs)
  if (!reference) {
    return []
  }
  return others.flatMap((other) =>
    compareTwo(
      [reference.adapter, other.adapter],
      normalizeRun(reference.frames),
      normalizeRun(other.frames),
      [lacksOf(reference), lacksOf(other)]
    )
  )
}

/** Runs in adapter order: the first is the reference every other is compared with. */
const byAdapter = (runs: RunReport[]) =>
  [...runs].sort((a, b) => a.adapter.localeCompare(b.adapter))

function lacksOf(run: RunReport): Lacks {
  const gaps = gapsFor(run.adapter, run.bidi)
  return {
    steps: gaps.flatMap((g) => g.lacksSteps ?? []),
    targets: gaps.flatMap((g) => g.lacksTargets ?? [])
  }
}

// A target either side cannot show is compared on neither.
function withoutTargets(steps: NormalizedStep[], targets: string[]) {
  return steps.map((s) =>
    targets.includes(s.action) ? { ...s, target: '' } : s
  )
}

// What a side declares it never shows is excused only where the other side shows nothing in its place.
function unexcused(hunk: Hunk, lacksA: Lacks, lacksB: Lacks): Hunk {
  return {
    after: hunk.after,
    a: hunk.b.length ? hunk.a : hunk.a.filter((s) => !lacked(lacksB, s)),
    b: hunk.a.length ? hunk.b : hunk.b.filter((s) => !lacked(lacksA, s))
  }
}

const afterOf = (hunk: Hunk) => (hunk.after ? stepKey(hunk.after) : 'its start')

// A step each side shows once, but at different places in the test, is one move rather than a missing step and an extra one.
function extractMoves(hunks: Hunk[]): Move[] {
  const moves: Move[] = []
  for (const from of hunks) {
    for (const step of [...from.a]) {
      const to = hunks.find(
        (h) => h !== from && h.b.some((s) => stepKey(s) === stepKey(step))
      )
      if (!to) {
        continue
      }
      from.a.splice(from.a.indexOf(step), 1)
      const [counterpart] = to.b.splice(
        to.b.findIndex((s) => stepKey(s) === stepKey(step)),
        1
      )
      moves.push({
        a: step,
        b: counterpart,
        afterA: afterOf(from),
        afterB: afterOf(to)
      })
    }
  }
  return moves
}

function compareTwo(
  adapters: [AdapterId, AdapterId],
  a: NormalizedRun,
  b: NormalizedRun,
  [lacksA, lacksB]: [Lacks, Lacks]
): Divergence[] {
  const out: Divergence[] = []
  const add: Add = (rule, message, at) =>
    out.push({
      rule,
      adapters,
      at,
      message: `${adapters.join(' vs ')}: ${message}`
    })
  const targets = [...lacksA.targets, ...lacksB.targets]
  const aligned = alignSteps(
    withoutTargets(a.steps, targets),
    withoutTargets(b.steps, targets)
  )
  for (const { test, pairs, hunks } of aligned) {
    const moves = extractMoves(hunks)
    for (const move of moves) {
      add(
        RULES.agreeOnActions,
        `${testLabel(test)}: ${stepKey(move.a)} comes after ${move.afterA} in ${adapters[0]}, after ${move.afterB} in ${adapters[1]}`
      )
    }
    for (const hunk of hunks.map((h) => unexcused(h, lacksA, lacksB))) {
      if (hunk.a.length || hunk.b.length) {
        add(
          RULES.agreeOnActions,
          `${testLabel(test)}, after ${afterOf(hunk)}: ${adapters[0]} shows [${list(hunk.a)}], ${adapters[1]} shows [${list(hunk.b)}]`
        )
      }
    }
    for (const [x, y] of [...pairs, ...moves.map((m) => [m.a, m.b] as const)]) {
      const where = `${testLabel(test)}, ${stepKey(x)}`
      compareStep(adapters, where, x, y, add)
      compareChildren(adapters, where, x, y, [lacksA, lacksB], add)
    }
  }
  compareRunWide(a, b, add)
  return out
}

// The steps a step issued are compared as their own sequence under it: aligned, then each pair as a step.
function compareChildren(
  adapters: [AdapterId, AdapterId],
  where: string,
  parentA: NormalizedStep,
  parentB: NormalizedStep,
  [lacksA, lacksB]: [Lacks, Lacks],
  add: Add
): void {
  const targets = [...lacksA.targets, ...lacksB.targets]
  const aligned = alignSteps(
    withoutTargets(parentA.children ?? [], targets),
    withoutTargets(parentB.children ?? [], targets)
  )
  for (const { pairs, hunks } of aligned) {
    for (const hunk of hunks.map((h) => unexcused(h, lacksA, lacksB))) {
      if (hunk.a.length || hunk.b.length) {
        add(
          RULES.agreeOnActions,
          `${where}, inside it after ${afterOf(hunk)}: ${adapters[0]} shows [${list(hunk.a)}], ${adapters[1]} shows [${list(hunk.b)}]`
        )
      }
    }
    for (const [x, y] of pairs) {
      const inner = `${where} > ${stepKey(x)}`
      compareStep(adapters, inner, x, y, add)
      compareChildren(adapters, inner, x, y, [lacksA, lacksB], add)
    }
  }
}

const list = (steps: NormalizedStep[]) => steps.map(stepKey).join(', ')

function compareRunWide(a: NormalizedRun, b: NormalizedRun, add: Add): void {
  if (!sameList(a.snapshots, b.snapshots)) {
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
  if (!sameList(a.requests, b.requests)) {
    add(
      RULES.agreeOnRequests,
      `requests [${a.requests.join(', ')}] vs [${b.requests.join(', ')}]`
    )
  }
}

// Each side is named in its own clause, so a gap can match its holder's side whichever is the reference.
function compareStep(
  [nameA, nameB]: [AdapterId, AdapterId],
  where: string,
  a: NormalizedStep,
  b: NormalizedStep,
  add: Add
): void {
  const at = { [nameA]: a.at, [nameB]: b.at }
  if (a.input !== b.input) {
    add(
      RULES.agreeOnActions,
      `${where}: ${nameA} types ${JSON.stringify(a.input)}, ${nameB} types ${JSON.stringify(b.input)}`,
      at
    )
  }
  if (a.outcome !== b.outcome) {
    add(
      RULES.agreeOnErrors,
      `${where}: ${nameA} ${a.outcome}, ${nameB} ${b.outcome}`,
      at
    )
  }
  if (a.page !== b.page) {
    add(
      RULES.agreeOnPages,
      `${where}: ${nameA} shows ${a.page}, ${nameB} shows ${b.page}`,
      at
    )
  }
}

/** Whether no run the holder is compared with shows what the lack excuses, so nothing checks that step at all. */
function lackUnused(
  gap: KnownGap,
  comparedWith: RunReport[],
  normalized: Map<AdapterId, NormalizedRun>
): boolean {
  const lacks: Lacks = { steps: gap.lacksSteps ?? [], targets: [] }
  const shown = (test: (s: NormalizedStep) => boolean) =>
    comparedWith.some((r) =>
      allSteps(normalized.get(r.adapter)!.steps).some(test)
    )
  return (
    (lacks.steps.length > 0 && !shown((s) => lacked(lacks, s))) ||
    (Boolean(gap.lacksTargets?.length) &&
      !shown((s) => gap.lacksTargets!.includes(s.action) && s.target !== ''))
  )
}

/** Whether a lack no longer holds: the holder shows the step, or shows some other step where the lacked one stands. */
function lackContradicted(
  gap: KnownGap,
  holder: RunReport,
  comparedWith: RunReport[],
  normalized: Map<AdapterId, NormalizedRun>
): boolean {
  const lacks: Lacks = {
    steps: gap.lacksSteps ?? [],
    targets: gap.lacksTargets ?? []
  }
  const steps = normalized.get(holder.adapter)!.steps
  if (
    allSteps(steps).some(
      (s) =>
        lacked(lacks, s) ||
        (lacks.targets.includes(s.action) && s.target !== '')
    )
  ) {
    return true
  }
  return comparedWith.some((other) => {
    const targets = [...lacksOf(holder).targets, ...lacksOf(other).targets]
    return alignSteps(
      withoutTargets(steps, targets),
      withoutTargets(normalized.get(other.adapter)!.steps, targets)
    ).some(({ hunks }) =>
      hunks.some((h) => h.a.length > 0 && h.b.some((s) => lacked(lacks, s)))
    )
  })
}

/** A divergence is explained only by a gap occurring on that very subject, unless the other side declares its own. */
export function judgeDivergences(
  divergences: Divergence[],
  runs: RunReport[]
): { unexplained: Divergence[]; explained: Divergence[]; stale: KnownGap[] } {
  const readable = runs.filter((r) => !r.checkerError)
  const [reference] = byAdapter(readable)
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
      if (g.against && !readable.some((r) => r.adapter === g.against)) {
        return false
      }
      if (declaresLacks(g)) {
        // Judged against the runs compareRuns pairs it with: the reference, or every other run for the reference itself.
        const comparedWith =
          run === reference ? readable.filter((r) => r !== run) : [reference]
        return (
          lackUnused(g, comparedWith, normalized) ||
          lackContradicted(g, run, comparedWith, normalized)
        )
      }
      const own = g.rules.filter(isAgreementRule)
      return (
        !g.timingDependent &&
        own.length > 0 &&
        !divergences.some(
          (d) =>
            d.adapters.includes(run.adapter) &&
            isAgreementRule(d.rule) &&
            covers(g, d)
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
  const gaps = gapsFor(holder.adapter, holder.bidi).filter((g) => covers(g, d))
  if (!gaps.length) {
    return false
  }
  const gapRules = new Set(gaps.flatMap((g) => g.rules))
  const shown = holder.violations.filter((v) => gapRules.has(v.rule))
  if (d.rule === RULES.agreeOnPages && d.at) {
    return pagesExplained(d.at, shown, holder, other, normalized)
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
  // Every adapter offers every run control its runner can serve, so no gap excuses a difference here.
  if (d.rule === RULES.agreeOnRunControls) {
    return false
  }
  if (d.rule === RULES.agreeOnRequests) {
    // Each side's requests plus the loads its own declared gap left unlisted must agree.
    const requests = (run: RunReport, violations: Violation[]) =>
      [
        ...(normalized.get(run.adapter)?.requests ?? []),
        ...violations
          .filter((v) => v.rule === RULES.requestListed && v.subject?.url)
          .flatMap((v) =>
            Array<string>((v.subject!.made ?? 0) - (v.subject!.rows ?? 0)).fill(
              pathOf(v.subject!.url!)
            )
          )
      ].sort()
    const otherDeclared = other.violations.filter((v) => declared(other, v))
    return (
      sameList(requests(holder, shown), requests(other, otherDeclared)) &&
      !other.violations.some(
        (v) => v.subject?.kind === 'request' && !declared(other, v)
      )
    )
  }
  // A rule with no per-run counterpart (actions, errors): the difference is the gap.
  return true
}

// The holder's gap must show on that row, or as the page the row should replay never being anchored (a read rule-checks no page of its own).
function pagesExplained(
  at: NonNullable<Divergence['at']>,
  shown: Violation[],
  holder: RunReport,
  other: RunReport,
  normalized: Map<AdapterId, NormalizedRun>
): boolean {
  const otherPage = normalized
    .get(other.adapter)
    ?.steps.find((s) => s.at === at[other.adapter])?.page
  const neverAnchored = shown.some(
    (v) =>
      v.rule === RULES.documentAnchored &&
      v.subject?.url !== undefined &&
      pathOf(v.subject.url) === otherPage
  )
  return (
    (shown.some((v) => onRow(v, at[holder.adapter])) || neverAnchored) &&
    !other.violations.some(
      (v) => onRow(v, at[other.adapter]) && !declared(other, v)
    )
  )
}

const sameRunControls = (a: RunControls, b: RunControls) =>
  a.served === b.served && sameList(a.advertised, b.advertised)

const declared = (run: RunReport, v: Violation) =>
  Boolean(explainingGap(gapsFor(run.adapter, run.bidi), v))

const onRow = (v: Violation, at: number | undefined) =>
  at !== undefined && v.subject?.kind === 'row' && v.subject.timestamp === at

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i])
