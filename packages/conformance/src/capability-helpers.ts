import { RULES } from './constants.js'
import type { AdapterId, Cell, RuleId } from './types.js'

/** Where each adapter's own tests live, from the repo root. */
export const ADAPTER_TESTS: Record<AdapterId, string> = {
  'devtools-service': 'packages/service/tests/',
  'selenium-devtools': 'packages/selenium-devtools/tests/',
  'nightwatch-devtools': 'packages/nightwatch-devtools/tests/',
  'selenium-devtools-py': 'packages/selenium-devtools-py/tests/'
}

/** Packages every adapter builds on, so their tests may stand in where an adapter adds no logic of its own. */
export const SHARED_TESTS = [
  'packages/core/tests/',
  'packages/trace/tests/',
  'packages/backend/tests/'
]

export const DOM_RULES: RuleId[] = [
  RULES.documentAnchored,
  RULES.anchorOnce,
  RULES.anchorBirthTime,
  RULES.rowReplaysPage
]
export const ACTION_RULES: RuleId[] = [
  RULES.rowPerAction,
  RULES.completionStamp,
  RULES.navigationNamesDestination,
  RULES.replaceTargetsRow
]
export const NETWORK_RULES: RuleId[] = [
  RULES.requestListed,
  RULES.requestListedOnce,
  RULES.requestSourceServed
]
export const ERROR_RULES: RuleId[] = [
  RULES.failureRecorded,
  RULES.errorCarriesBrowserMessage
]
export const FAILED_TEST_RULES: RuleId[] = [
  ...ERROR_RULES,
  RULES.failedTestExplained
]

/** Supported, and checked for this adapter by the conformance suite. */
export const tested = (rules: RuleId[], label?: string): Cell => ({
  support: 'supported',
  evidence: { kind: 'rule', rules },
  label
})
/** Supported, and exercised by this test file. */
export const covered = (path: string, label?: string): Cell => ({
  support: 'supported',
  evidence: { kind: 'test', path },
  label
})
/** Supported, and checked by hand for the stated reason. */
export const byHand = (reason: string, label?: string): Cell => ({
  support: 'supported',
  evidence: { kind: 'manual', reason },
  label
})
export const partial = (reason: string, label?: string): Cell => ({
  support: 'partial',
  reason,
  label
})
export const unsupported = (reason: string, label?: string): Cell => ({
  support: 'unsupported',
  reason,
  label
})

export const allTested = (rules: RuleId[]): Record<AdapterId, Cell> => ({
  'devtools-service': tested(rules),
  'selenium-devtools': tested(rules),
  'nightwatch-devtools': tested(rules),
  'selenium-devtools-py': tested(rules)
})

// Built from the stream every adapter sends, so one shared test covers all four.
export const allCovered = (path: string): Record<AdapterId, Cell> => ({
  'devtools-service': covered(path),
  'selenium-devtools': covered(path),
  'nightwatch-devtools': covered(path),
  'selenium-devtools-py': covered(path)
})

/** The one definition of "tested" that parity and rule coverage both read. */
export function conformanceRules(cell: Cell): readonly RuleId[] {
  return cell.support === 'supported' && cell.evidence.kind === 'rule'
    ? cell.evidence.rules
    : []
}
