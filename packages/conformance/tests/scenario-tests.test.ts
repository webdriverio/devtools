import { describe, expect, it } from 'vitest'

import { readStream } from '../src/checker.js'
import { RULES, SCENARIO_TESTS } from '../src/constants.js'
import {
  checkTestOutcomes,
  checkTestRows,
  reportedTests,
  scenarioTestOf
} from '../src/scenario-tests.js'
import type { WireFrame } from '../src/types.js'

/** One suites frame reporting each test as [title, state, start ms]. */
const suites = (tests: [string, string, number][]): WireFrame => ({
  scope: 'suites',
  data: [
    {
      s: {
        uid: 's',
        title: 'conformance',
        tests: tests.map(([title, state, start], i) => ({
          uid: `t${i}`,
          title,
          state,
          start: new Date(start).toISOString()
        })),
        suites: []
      }
    }
  ]
})

const designed = (): [string, string, number][] =>
  SCENARIO_TESTS.map((t, i) => [t.title, t.state, i * 100])

describe('checkTestOutcomes', () => {
  it('passes a run whose tests end as the scenario designs them', () => {
    expect(checkTestOutcomes([suites(designed())])).toEqual([])
  })

  it("reads pytest's function names as the scenario's titles", () => {
    const pytest = designed().map(
      ([title, state, start]): [string, string, number] => [
        `test_${title.replace(/ /g, '_')}`,
        state,
        start
      ]
    )
    expect(checkTestOutcomes([suites(pytest)])).toEqual([])
  })

  it('flags a test that ends otherwise, and one never reported', () => {
    const tests = designed()
    tests[0] = [tests[0][0], 'failed', 0]
    const violations = checkTestOutcomes([suites(tests.slice(0, -1))])
    expect(violations.map((v) => v.rule)).toEqual([
      RULES.testsAsDesigned,
      RULES.testsAsDesigned
    ])
    expect(violations.map((v) => v.message)).toEqual([
      `"${SCENARIO_TESTS[0].title}" is reported failed; the scenario designs it to end passed`,
      `"${SCENARIO_TESTS.at(-1)!.title}" is never reported; the scenario designs it to end passed`
    ])
  })

  it('takes the latest report of each test', () => {
    const running = designed().map(([t, , start]): [string, string, number] => [
      t,
      'running',
      start
    ])
    expect(checkTestOutcomes([suites(running), suites(designed())])).toEqual([])
  })
})

describe('scenarioTestOf', () => {
  const tests = reportedTests([suites(designed())])

  it('places a row by the test its uid names, before its time', () => {
    expect(scenarioTestOf(tests, { testUid: 't1', timestamp: 250 })).toBe(1)
  })

  it('places a row without a known uid in the last test started by then', () => {
    expect(scenarioTestOf(tests, { timestamp: 250 })).toBe(2)
    expect(scenarioTestOf(tests, { startTime: 99, timestamp: 150 })).toBe(0)
    expect(scenarioTestOf(tests, { timestamp: -1 })).toBe(-1)
  })
})

describe('checkTestRows', () => {
  const ERROR = { name: 'Error', message: 'boom' }

  /** One row per scenario test, inside its window, the designed failures carrying an error. */
  const rows = (): Record<string, unknown>[] =>
    SCENARIO_TESTS.map((t, i) => ({
      command: 'getText',
      args: [],
      timestamp: i * 100 + 50,
      ...(t.state === 'failed' ? { error: ERROR } : {})
    }))
  const judge = (
    tests: [string, string, number][],
    commands: object[] = rows()
  ) =>
    checkTestRows(
      readStream([suites(tests), { scope: 'commands', data: commands }])
    )
  const [, , HEADING, MISSING] = SCENARIO_TESTS.map((t) => t.title)

  it('passes a run where every test has rows and every failed test an error row', () => {
    expect(judge(designed())).toEqual([])
  })

  // The Selenium first-test race: hooks registered on a poll missed a test that started sooner.
  it('flags a test the tree shows with no rows', () => {
    expect(judge(designed(), rows().slice(1))).toEqual([
      {
        rule: RULES.testHasRows,
        message: `"${SCENARIO_TESTS[0].title}" is reported passed but has no rows`
      }
    ])
  })

  // The Selenium timed-out wait: no row carried the TimeoutError, so the failed test simply stopped.
  it('flags a failed test none of whose rows carries an error', () => {
    const commands = rows()
    commands[3] = { ...commands[3], error: undefined }
    expect(judge(designed(), commands)).toEqual([
      {
        rule: RULES.failedTestExplained,
        message: `"${MISSING}" failed but none of its 1 row(s) is a failed action`
      }
    ])
  })

  it('judges a test designed to fail even when the tree shows it passed', () => {
    const tests = designed()
    tests[2] = [HEADING, 'passed', 200]
    const commands = rows()
    commands[2] = { ...commands[2], error: undefined }
    expect(judge(tests, commands).map((v) => v.rule)).toEqual([
      RULES.failedTestExplained
    ])
  })

  it('judges a test the tree shows failed although it was designed to pass', () => {
    const tests = designed()
    tests[0] = [tests[0][0], 'failed', 0]
    expect(judge(tests).map((v) => v.rule)).toEqual([RULES.failedTestExplained])
  })

  it("reads a failure by shared's rule, so a wait that resolved false counts", () => {
    const commands = rows()
    commands[3] = {
      command: 'waitForElementVisible',
      args: ['#missing'],
      result: false,
      timestamp: 350
    }
    expect(judge(designed(), commands)).toEqual([])
  })

  // Python's timed-out WebDriverWait: its polls are unmapped findElement rows that error, as a passing wait's do.
  it('does not take an unmapped poll that errored for the failure', () => {
    const commands = rows()
    commands[3] = {
      command: 'findElement',
      args: [],
      timestamp: 350,
      error: { name: 'NoSuchElementError', message: 'no element #missing' }
    }
    expect(judge(designed(), commands).map((v) => v.rule)).toEqual([
      RULES.failedTestExplained
    ])
  })

  it('places a row by the test its uid names, so an error stamped for one test explains no other', () => {
    const commands = rows()
    commands[3] = { ...commands[3], timestamp: 50, testUid: 't3' }
    commands[2] = { ...commands[2], testUid: 't0' }
    expect(judge(designed(), commands)).toEqual([
      expect.objectContaining({ rule: RULES.testHasRows }),
      expect.objectContaining({ rule: RULES.failedTestExplained })
    ])
  })

  it('leaves a test the tree never reports to tests-end-as-designed', () => {
    expect(judge(designed().slice(0, -1), rows().slice(0, -1))).toEqual([])
  })
})
