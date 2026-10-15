import { BIDI_MODES, RULES } from './constants.js'
import type {
  AdapterId,
  BidiMode,
  Judgement,
  KnownGap,
  RuleId,
  Violation
} from './types.js'

export const KNOWN_GAPS: KnownGap[] = [
  {
    adapter: 'selenium-devtools',
    bidi: 'off',
    rules: [
      'every-document-anchored',
      'row-replays-its-page',
      'every-browser-request-listed',
      'adapters-agree-on-pages',
      'adapters-agree-on-snapshots',
      'adapters-agree-on-requests'
    ],
    reason:
      'Without BiDi the collector is appended as a <script> after a readiness poll, so a document the test leaves within tens of ms is never anchored and its Resource Timing buffer dies undrained with it. CLAUDE.md Known debt: "Document-start injection is what removes the whole race class".',
    timingDependent: true
  },
  {
    adapter: 'nightwatch-devtools',
    bidi: 'off',
    rules: [
      'every-document-anchored',
      'row-replays-its-page',
      'every-browser-request-listed',
      'adapters-agree-on-pages',
      'adapters-agree-on-snapshots',
      'adapters-agree-on-requests'
    ],
    reason:
      'Without BiDi the collector is appended as a <script> and the destination is anchored by polling for the old collector to disappear, so a document the test leaves within tens of ms is never anchored and its Resource Timing buffer dies undrained with it. CLAUDE.md Known debt: "Document-start injection is what removes the whole race class".',
    timingDependent: true
  },
  ...BIDI_MODES.map((bidi): KnownGap => ({
    adapter: 'nightwatch-devtools',
    bidi,
    rules: [RULES.agreeOnRunControls],
    lacksRunControls: ['canRunAll'],
    reason:
      'Nightwatch advertises no Run-all: the backend reruns a Nightwatch config through its framework path, which selects suites and tests but has no whole-run entry. Documented on the capability matrix.'
  }))
]

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
        !violations.some((v) => own.includes(v.rule))
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
  return gaps.find((g) => g.rules.includes(violation.rule))
}
