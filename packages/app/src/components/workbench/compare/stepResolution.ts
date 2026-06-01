import type {
  CommandLog,
  PreservedAttempt,
  PreservedStep
} from '@wdio/devtools-shared'
import type { SuiteStatsFragment } from '../../../controller/types.js'
import {
  cleanErrorMessage,
  extractExpectedFromStepText,
  safeJson
} from './compareUtils.js'

/**
 * Walk the live suite tree to find the subtree rooted at `selectedTestUid`
 * and flatten its test entries into `PreservedStep[]` so the compare panel
 * can treat live and baseline data uniformly.
 *
 * Returns `[]` when the selected UID isn't found in any chunk (e.g. when the
 * user navigated to a stale UID that's no longer in the dashboard tree).
 */
export function liveStepsForUid(
  selectedTestUid: string | undefined,
  liveSuites: Array<Record<string, SuiteStatsFragment | undefined>> | undefined
): PreservedStep[] {
  if (!selectedTestUid || !liveSuites) {
    return []
  }
  let foundRoot: SuiteStatsFragment | undefined
  const findRoot = (
    s: SuiteStatsFragment | undefined
  ): SuiteStatsFragment | undefined => {
    if (!s) {
      return undefined
    }
    if (s.uid === selectedTestUid) {
      return s
    }
    for (const child of s.suites ?? []) {
      const hit = findRoot(child)
      if (hit) {
        return hit
      }
    }
    return undefined
  }
  for (const chunk of liveSuites) {
    for (const root of Object.values(chunk)) {
      foundRoot = findRoot(root)
      if (foundRoot) {
        break
      }
    }
    if (foundRoot) {
      break
    }
  }
  if (!foundRoot) {
    return []
  }
  const out: PreservedStep[] = []
  const visit = (s: SuiteStatsFragment) => {
    for (const t of s.tests ?? []) {
      out.push({
        uid: t.uid,
        title: t.title,
        fullTitle: t.fullTitle,
        start: t.start ? new Date(t.start).getTime() : undefined,
        end: t.end ? new Date(t.end).getTime() : undefined,
        state:
          t.state === 'pending' || t.state === 'running' ? t.state : t.state,
        error: t.error
          ? {
              message: t.error.message,
              name: t.error.name,
              stack: t.error.stack
            }
          : undefined
      })
    }
    for (const child of s.suites ?? []) {
      visit(child)
    }
  }
  visit(foundRoot)
  return out
}

/**
 * Find which preserved step a command belongs to, by timestamp containment.
 * The `side` selects whether to search the baseline's preserved steps or the
 * live (selected-uid) steps.
 */
export function findStepFor(
  cmd: CommandLog | undefined,
  side: 'baseline' | 'latest',
  baseline: PreservedAttempt | undefined,
  liveSteps: PreservedStep[]
): PreservedStep | undefined {
  if (!cmd?.timestamp) {
    return undefined
  }
  const steps = side === 'baseline' ? (baseline?.steps ?? []) : liveSteps
  const ts = cmd.timestamp
  return steps.find(
    (s) =>
      s.start !== null &&
      s.start !== undefined &&
      s.end !== null &&
      s.end !== undefined &&
      ts >= s.start &&
      ts <= s.end
  )
}

/**
 * Pre-computed data for one side of a detail-block render. Pulling this out
 * of compare.ts's `#renderDetailBlock` lets the template stay focused on
 * markup and lets the computation be tested in isolation.
 */
export interface DetailBlockData {
  argsStr: string
  resultStr: string
  step: PreservedStep | undefined
  atFailureSite: boolean
  expected: unknown
  actual: unknown
  assertionMessage: string | undefined
  fallbackExpected: string | undefined
  stepText: string
}

export function computeDetailBlockData(
  cmd: CommandLog,
  step: PreservedStep | undefined,
  allCommandsOnSide: CommandLog[]
): DetailBlockData {
  const atFailureSite = isFailureSite(cmd, step, allCommandsOnSide)
  const expected =
    atFailureSite && step?.error?.expected !== undefined
      ? step.error.expected
      : atFailureSite
        ? step?.error?.matcherResult?.expected
        : undefined
  const actual =
    atFailureSite && step?.error?.actual !== undefined
      ? step.error.actual
      : atFailureSite
        ? step?.error?.matcherResult?.actual
        : undefined
  const rawAssertion = atFailureSite
    ? step?.error?.matcherResult?.message || step?.error?.message
    : undefined
  const assertionMessage = rawAssertion
    ? cleanErrorMessage(rawAssertion)
    : undefined
  const stepText = step?.fullTitle || step?.title || ''
  // Fallback: extract the expected from the Cucumber step text when the
  // assertion library didn't surface a structured expected value.
  const fallbackExpected =
    atFailureSite && expected === undefined && step?.state === 'failed'
      ? extractExpectedFromStepText(stepText)
      : undefined

  return {
    argsStr: safeJson(cmd.args),
    resultStr: safeJson(cmd.result),
    step,
    atFailureSite,
    expected,
    actual,
    assertionMessage,
    fallbackExpected,
    stepText
  }
}

/**
 * Identify the "failure site" of a failed step — either the command whose own
 * `error` is set (the WebDriver-level failure) OR the last command before the
 * step's end time (the assertion site, where the matcher threw).
 */
export function isFailureSite(
  cmd: CommandLog,
  step: PreservedStep | undefined,
  allCommandsOnSide: CommandLog[]
): boolean {
  if (!step || step.state !== 'failed') {
    return false
  }
  if (cmd.error?.message) {
    return true
  }
  if (step.start === null || step.end === null) {
    return false
  }
  let lastTs = 0
  for (const c of allCommandsOnSide) {
    if (
      c.timestamp !== null &&
      step.start !== undefined &&
      step.end !== undefined &&
      c.timestamp >= step.start &&
      c.timestamp <= step.end &&
      c.timestamp > lastTs
    ) {
      lastTs = c.timestamp
    }
  }
  return cmd.timestamp === lastTs
}
