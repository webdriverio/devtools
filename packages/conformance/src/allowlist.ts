import { BIDI_MODES, KNOWN_DEBT, RULES } from './constants.js'
import { anyOf, hunkInside } from './gap-matchers.js'
import { scenarioIndex } from './scenario-tests.js'
import type {
  AdapterId,
  BidiMode,
  Judgement,
  KnownGap,
  RuleId,
  Violation
} from './types.js'

const [LOGIN, MISSING] = [
  'logs in and reads the greeting',
  'times out waiting for a missing element'
].map(scenarioIndex)

/** What a document left before an appended collector anchors it costs, in either adapter without BiDi. */
const SCRIPT_INJECTION_RULES: RuleId[] = [
  'every-document-anchored',
  'row-replays-its-page',
  'every-browser-request-listed',
  'adapters-agree-on-pages',
  'adapters-agree-on-snapshots',
  'adapters-agree-on-requests'
]

export const KNOWN_GAPS: KnownGap[] = [
  {
    adapter: 'selenium-devtools',
    bidi: 'off',
    rules: SCRIPT_INJECTION_RULES,
    reason:
      'Without BiDi the collector is appended as a <script> after a readiness poll, so a document the test leaves within tens of ms is never anchored and its Resource Timing buffer dies undrained with it. CLAUDE.md Known debt: "Document-start injection is what removes the whole race class".',
    timingDependent: true
  },
  {
    adapter: 'nightwatch-devtools',
    bidi: 'off',
    rules: SCRIPT_INJECTION_RULES,
    reason:
      'Without BiDi the collector is appended as a <script> and the destination is anchored by polling for the old collector to disappear, so a document the test leaves within tens of ms is never anchored and its Resource Timing buffer dies undrained with it. CLAUDE.md Known debt: "Document-start injection is what removes the whole race class".',
    timingDependent: true
  },
  ...BIDI_MODES.flatMap(serviceGaps)
]

/** The service nests an element wait's isExisting polls, which no other adapter shows in the trace vocabulary. */
function serviceGaps(bidi: BidiMode): KnownGap[] {
  const adapter = 'devtools-service'
  const pollsUnder = (test: number, wait: string) =>
    hunkInside(test, wait, 'its start', adapter, 'Element.isExisting', '')
  return [
    {
      adapter,
      bidi,
      rules: [RULES.agreeOnActions],
      only: anyOf(
        pollsUnder(LOGIN, 'Element.waitForExist #flash'),
        pollsUnder(MISSING, 'Element.waitForExist #missing')
      ),
      reason: KNOWN_DEBT.elementWaitPolls
    }
  ]
}

/** A gap that declares what the holder lacks is applied by the comparison, so it excuses no violation itself. */
export function declaresLacks(gap: KnownGap): boolean {
  return Boolean(gap.lacksSteps?.length || gap.lacksTargets?.length)
}

/** Whether a gap explains one violation or divergence: under its rules, and matching its `only` where it sets one. */
export function covers(gap: KnownGap, violation: Violation): boolean {
  return (
    gap.rules.includes(violation.rule) &&
    !declaresLacks(gap) &&
    (!gap.only || gap.only(violation.message))
  )
}

/** An `adapters-agree-*` rule is judged by the comparison; every other rule by the run itself. */
export function isAgreementRule(rule: RuleId): boolean {
  return rule.startsWith('adapters-agree-')
}

/** Judges one run's own violations: a gap counts as stale only through the rules this run can show. */
export function judge(
  adapter: AdapterId,
  bidi: BidiMode,
  violations: Violation[]
): Judgement {
  const gaps = gapsFor(adapter, bidi)
  return {
    unexplained: violations.filter((v) => !explainingGap(gaps, v)),
    stale: gaps.filter((g) => {
      const own = g.rules.filter((r) => !isAgreementRule(r))
      return (
        !g.timingDependent &&
        own.length > 0 &&
        !violations.some((v) => !isAgreementRule(v.rule) && covers(g, v))
      )
    })
  }
}

export function gapsFor(adapter: AdapterId, bidi: BidiMode): KnownGap[] {
  return KNOWN_GAPS.filter((g) => g.adapter === adapter && g.bidi === bidi)
}

export function explainingGap(
  gaps: KnownGap[],
  violation: Violation
): KnownGap | undefined {
  return gaps.find((g) => covers(g, violation))
}
