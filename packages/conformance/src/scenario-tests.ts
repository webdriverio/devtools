import {
  commandFailure,
  mapCommandToAction,
  TEST_STATE,
  type CommandLog,
  type SuiteStats,
  type TestStats
} from '@wdio/devtools-shared'

import { RULES, SCENARIO_TESTS, SCOPES } from './constants.js'
import type {
  RecordedStream,
  ReportedTest,
  Violation,
  WireFrame
} from './types.js'

/** A title as every runner spells it: pytest's `test_logs_in` reads as `logs in`. */
const titleKey = (title: string) =>
  title
    .toLowerCase()
    .replace(/^test_/, '')
    .replace(/_/g, ' ')
    .trim()

/** The scenario test a reported title names, as an index into SCENARIO_TESTS; -1 for none. */
export function scenarioIndex(title: string): number {
  const key = titleKey(title)
  return SCENARIO_TESTS.findIndex((t) => titleKey(t.title) === key)
}

/** Every test the suites frames report, the latest report of each winning, in start order. */
export function reportedTests(frames: WireFrame[]): ReportedTest[] {
  const byUid = new Map<string, ReportedTest>()
  const walk = (suite: SuiteStats) => {
    for (const test of suite.tests ?? []) {
      if (typeof test !== 'string') {
        byUid.set(test.uid, reported(test))
      }
    }
    for (const child of suite.suites ?? []) {
      walk(child)
    }
  }
  for (const { scope, data } of frames) {
    if (scope === SCOPES.suites && Array.isArray(data)) {
      for (const record of data as Record<string, SuiteStats>[]) {
        Object.values(record).forEach(walk)
      }
    }
  }
  return [...byUid.values()].sort((a, b) => a.start - b.start)
}

function reported(test: TestStats): ReportedTest {
  return {
    uid: test.uid,
    title: test.title,
    state: test.state,
    start: new Date(test.start).getTime()
  }
}

/** The scenario test a row ran in: the test its uid names, else the last to have started by then; -1 before the first. */
export function scenarioTestOf(
  tests: ReportedTest[],
  row: { testUid?: string; startTime?: number; timestamp: number }
): number {
  const at = row.startTime ?? row.timestamp
  const running =
    tests.find((t) => t.uid === row.testUid) ??
    tests.filter((t) => t.start <= at).at(-1)
  return running ? scenarioIndex(running.title) : -1
}

// Judged from what the adapter reported, so a test the runner ran right but the dashboard shows wrong is caught.
export function checkTestOutcomes(frames: WireFrame[]): Violation[] {
  const tests = reportedTests(frames)
  return SCENARIO_TESTS.flatMap(({ title, state }): Violation[] => {
    const shown = tests.find((t) => titleKey(t.title) === titleKey(title))
    if (shown?.state === state) {
      return []
    }
    return [
      {
        rule: RULES.testsAsDesigned,
        message: shown
          ? `"${title}" is reported ${shown.state}; the scenario designs it to end ${state}`
          : `"${title}" is never reported; the scenario designs it to end ${state}`
      }
    ]
  })
}

// Only an action explains a failure: an unmapped poll errors while a passing wait polls too, and the trace drops it.
function actionFailed(row: CommandLog): boolean {
  const action = mapCommandToAction(row.command)
  return Boolean(action && commandFailure(row, action))
}

// A test never reported is tests-end-as-designed's finding; these judge the rows of the tests the tree shows.
export function checkTestRows(stream: RecordedStream): Violation[] {
  const tests = reportedTests(stream.frames)
  const rows = SCENARIO_TESTS.map((): CommandLog[] => [])
  for (const row of stream.rows) {
    rows[scenarioTestOf(tests, row)]?.push(row)
  }
  return SCENARIO_TESTS.flatMap(({ title, state }, i): Violation[] => {
    const shown = tests.find((t) => scenarioIndex(t.title) === i)
    if (!shown) {
      return []
    }
    const out: Violation[] = []
    if (!rows[i].length) {
      out.push({
        rule: RULES.testHasRows,
        message: `"${title}" is reported ${shown.state} but has no rows`
      })
    }
    // A test designed to fail is judged whatever it is reported, so one shown green cannot pass this vacuously.
    const failed = shown.state === TEST_STATE.FAILED || state === 'failed'
    if (failed && !rows[i].some(actionFailed)) {
      out.push({
        rule: RULES.failedTestExplained,
        message: `"${title}" failed but none of its ${rows[i].length} row(s) is a failed action`
      })
    }
    return out
  })
}
