import {
  BIDI_MODES,
  CONDITION_WAIT_READS,
  HELPER_WAIT_READ,
  KNOWN_DEBT,
  RULES
} from './constants.js'
import { anyOf, hunk } from './gap-matchers.js'
import { scenarioIndex } from './scenario-tests.js'
import type {
  AdapterId,
  BidiMode,
  Judgement,
  KnownGap,
  RuleId,
  Violation
} from './types.js'

const [WAITS, MISSING] = [
  'waits on what the page shows',
  'times out waiting for a missing element'
].map(scenarioIndex)

const FLASH_WAIT = 'Element.waitForExist #flash'

/** The scenario's two condition waits as the WebdriverIO service shows them, and as their reads. */
const CONDITION_WAITS = 'Browser.waitForFunction, Browser.waitForFunction'
const CONDITION_READS = [...CONDITION_WAIT_READS, HELPER_WAIT_READ]
  .map((selector) => `Element.getText ${selector}`)
  .join(', ')

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
  ...BIDI_MODES.flatMap((bidi) => [
    ...nightwatchGaps(bidi),
    ...seleniumGaps(bidi),
    ...pythonGaps(bidi)
  ])
]

/** Nightwatch's scenario gaps in one mode, each an adapter bug with its Known debt entry. */
function nightwatchGaps(bidi: BidiMode): KnownGap[] {
  const adapter = 'nightwatch-devtools'
  return [
    {
      adapter,
      bidi,
      rules: [RULES.agreeOnActions],
      only: anyOf(
        hunk(
          WAITS,
          'Element.getText #flash',
          adapter,
          'Element.getText #flash, Element.getText h2',
          ''
        ),
        hunk(
          WAITS,
          'Browser.waitForFunction',
          adapter,
          'Element.getText #flash',
          ''
        )
      ),
      reason: KNOWN_DEBT.conditionWait,
      against: 'devtools-service'
    }
  ]
}

function seleniumGaps(bidi: BidiMode): KnownGap[] {
  const adapter = 'selenium-devtools'
  return [
    {
      adapter,
      bidi,
      rules: [RULES.agreeOnActions],
      only: hunk(
        MISSING,
        'its start',
        adapter,
        'Browser.waitForFunction',
        'Element.waitForExist #missing'
      ),
      reason: KNOWN_DEBT.seleniumFailedWait,
      against: 'devtools-service'
    },
    {
      adapter,
      bidi,
      rules: [RULES.agreeOnActions],
      lacksSteps: [FLASH_WAIT],
      reason: KNOWN_DEBT.seleniumWait,
      against: 'devtools-service'
    },
    {
      adapter,
      bidi,
      rules: [RULES.agreeOnActions],
      only: hunk(
        WAITS,
        'Element.getText #flash',
        adapter,
        CONDITION_READS,
        CONDITION_WAITS
      ),
      reason: KNOWN_DEBT.conditionWait,
      against: 'devtools-service'
    }
  ]
}

function pythonGaps(bidi: BidiMode): KnownGap[] {
  const adapter = 'selenium-devtools-py'
  return [
    {
      adapter,
      bidi,
      rules: [RULES.agreeOnActions],
      only: hunk(
        MISSING,
        'its start',
        adapter,
        'Browser.waitForFunction',
        'Element.waitForExist #missing'
      ),
      reason: KNOWN_DEBT.pythonFailedWait,
      against: 'devtools-service'
    },
    {
      adapter,
      bidi,
      rules: [RULES.agreeOnActions],
      lacksSteps: [FLASH_WAIT],
      reason: KNOWN_DEBT.pythonWait,
      against: 'devtools-service'
    },
    {
      adapter,
      bidi,
      rules: [RULES.agreeOnActions],
      only: hunk(
        WAITS,
        'Element.getText #flash',
        adapter,
        CONDITION_READS,
        CONDITION_WAITS
      ),
      reason: KNOWN_DEBT.conditionWait,
      against: 'devtools-service'
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
