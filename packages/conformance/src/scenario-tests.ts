import {
  ASSERT_ACTION_CLASS,
  effectiveFailure,
  mapCommandToAction,
  retriedRows,
  TEST_STATE,
  type CommandLog,
  type SuiteStats,
  type TestStats
} from '@wdio/devtools-shared'

import { PAGE_TITLE_TEST, RULES, SCENARIO_TESTS, SCOPES } from './constants.js'
import type {
  RecordedStream,
  ReportedTest,
  TimedRow,
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
  row: TimedRow,
  at = row.startTime ?? row.timestamp
): number {
  const running =
    tests.find((t) => t.uid === row.testUid) ??
    tests.filter((t) => t.start <= at).at(-1)
  return running ? scenarioIndex(running.title) : -1
}

/**
 * Each row's scenario test, in row order. A uid the tree never reports still names one test's rows, so they are placed
 * together by the first of them: a test's last row can share its millisecond with the next test's start.
 */
export function scenarioTestsOf(
  tests: ReportedTest[],
  rows: TimedRow[]
): number[] {
  const firstAt = new Map<string, number>()
  for (const { testUid, startTime, timestamp } of rows) {
    if (testUid && !tests.some((t) => t.uid === testUid)) {
      const at = startTime ?? timestamp
      firstAt.set(testUid, Math.min(at, firstAt.get(testUid) ?? at))
    }
  }
  return rows.map((row) =>
    scenarioTestOf(
      tests,
      row,
      row.testUid ? firstAt.get(row.testUid) : undefined
    )
  )
}

/** Each scenario test's rows, indexed as SCENARIO_TESTS. */
function rowsByTest(stream: RecordedStream): CommandLog[][] {
  const tests = reportedTests(stream.frames)
  const rows = SCENARIO_TESTS.map((): CommandLog[] => [])
  scenarioTestsOf(tests, stream.rows).forEach((test, i) =>
    rows[test]?.push(stream.rows[i])
  )
  return rows
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

// Only an action's effective failure explains a failed test: an unmapped poll is dropped and a retried one is no failure.
function actionFailed(row: CommandLog, retried: ReadonlySet<CommandLog>) {
  return Boolean(
    mapCommandToAction(row.command) && effectiveFailure(row, retried)
  )
}

// The title reads the same as an element the test read just before, and the expected value as one read earlier, so
// a target taken from either is the wrong box: the assertion is about the page.
export function checkPageLevelAssertions(stream: RecordedStream): Violation[] {
  const test = scenarioIndex(PAGE_TITLE_TEST)
  const reported = reportedTests(stream.frames).some(
    (t) => scenarioIndex(t.title) === test
  )
  if (!reported) {
    return []
  }
  const asserts = rowsByTest(stream)[test].filter(
    (row) => mapCommandToAction(row.command)?.class === ASSERT_ACTION_CLASS
  )
  if (!asserts.length) {
    return [
      {
        rule: RULES.pageAssertNamesNoElement,
        message: `"${PAGE_TITLE_TEST}" has no assertion row to judge`
      }
    ]
  }
  return asserts
    .filter((row) => row.selector)
    .map((row) => ({
      rule: RULES.pageAssertNamesNoElement,
      message: `${row.command} on the page title names ${row.selector}`,
      subject: { kind: 'row' as const, timestamp: row.timestamp }
    }))
}

// A test never reported is tests-end-as-designed's finding; these judge the rows of the tests the tree shows.
export function checkTestRows(stream: RecordedStream): Violation[] {
  const tests = reportedTests(stream.frames)
  const rows = rowsByTest(stream)
  const retried = retriedRows(stream.rows)
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
    if (failed && !rows[i].some((row) => actionFailed(row, retried))) {
      out.push({
        rule: RULES.failedTestExplained,
        message: `"${title}" failed but none of its ${rows[i].length} row(s) is a failed action`
      })
    }
    return out
  })
}
