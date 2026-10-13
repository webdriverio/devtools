import type { AdapterId, Judgement, KnownGap, Violation } from './types.js'

export const KNOWN_GAPS: KnownGap[] = [
  {
    adapter: 'selenium-devtools',
    bidi: false,
    rules: [
      'every-document-anchored',
      'navigation-row-shows-destination',
      'adapters-agree-on-pages',
      'adapters-agree-on-snapshots'
    ],
    reason:
      'Without BiDi the collector is appended as a <script> after a readiness poll, so a document the test leaves within tens of ms is never anchored. CLAUDE.md Known debt: "Document-start injection is what removes the whole race class".',
    timingDependent: true
  }
]

export function judge(
  adapter: AdapterId,
  bidi: boolean,
  violations: Violation[]
): Judgement {
  const gaps = gapsFor(adapter, bidi)
  return {
    unexplained: violations.filter((v) => !explainingGap(gaps, v)),
    stale: gaps.filter(
      (g) =>
        !g.timingDependent && !violations.some((v) => g.rules.includes(v.rule))
    )
  }
}

export function gapsFor(adapter: AdapterId, bidi: boolean): KnownGap[] {
  return KNOWN_GAPS.filter((g) => g.adapter === adapter && g.bidi === bidi)
}

export function explainingGap(
  gaps: KnownGap[],
  violation: Violation
): KnownGap | undefined {
  return gaps.find((g) => g.rules.includes(violation.rule))
}
