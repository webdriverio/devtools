import { describe, expect, it } from 'vitest'

import { readStream } from '../src/checker.js'
import { PAGE_TITLE_TEST, RULES, SCENARIO_TESTS } from '../src/constants.js'
import {
  checkTestOutcomes,
  checkTestRows,
  checkPageLevelAssertions,
  reportedTests,
  scenarioIndex,
  scenarioTestOf,
  scenarioTestsOf
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

describe('scenarioTestsOf', () => {
  const tests = reportedTests([suites(designed())])

  // The WebdriverIO service tags rows with a uid the tree does not report, and a test's last row can share its
  // millisecond with the next test's start.
  it('keeps the rows of a uid the tree never reports in the test their first row ran in', () => {
    const rows = [
      { testUid: 'own', timestamp: 210 },
      { testUid: 'own', timestamp: 300 },
      { testUid: 'next', timestamp: 300 }
    ]
    expect(scenarioTestsOf(tests, rows)).toEqual([2, 2, 3])
  })

  it('places a row by the uid the tree reports, else by its own time', () => {
    const rows = [{ testUid: 't4', timestamp: 0 }, { timestamp: 150 }]
    expect(scenarioTestsOf(tests, rows)).toEqual([4, 1])
  })
})

describe(RULES.pageAssertNamesNoElement, () => {
  const AT_TITLE = scenarioIndex(PAGE_TITLE_TEST)
  const at = AT_TITLE * 100 + 50
  const judge = (commands: object[], tests = designed()) =>
    checkPageLevelAssertions(
      readStream([suites(tests), { scope: 'commands', data: commands }])
    )
  const read = { command: 'getText', args: [], selector: 'h2', timestamp: at }
  const titleRead = { command: 'getTitle', args: [], timestamp: at + 1 }
  const assertion = (extra = {}) => ({
    command: 'assert.notEqual',
    args: ['Login Page', 'Secure Area'],
    timestamp: at + 2,
    ...extra
  })

  it('passes an assertion on the title that names no element', () => {
    expect(judge([read, titleRead, assertion()])).toEqual([])
  })

  // The #476 failure: the expected value was an element's earlier read, so the title assertion boxed that element.
  it('flags an assertion on the title that names an element', () => {
    expect(judge([read, titleRead, assertion({ selector: 'h2' })])).toEqual([
      {
        rule: RULES.pageAssertNamesNoElement,
        message: 'assert.notEqual on the page title names h2',
        subject: { kind: 'row', timestamp: at + 2 }
      }
    ])
  })

  it('flags a test that shows no assertion row, which leaves nothing to judge', () => {
    expect(judge([read, titleRead]).map((v) => v.rule)).toEqual([
      RULES.pageAssertNamesNoElement
    ])
  })

  it('judges only the assertions of that test', () => {
    const elsewhere = assertion({ selector: 'h2', timestamp: 50 })
    expect(judge([elsewhere, read, titleRead, assertion()])).toEqual([])
  })

  it('leaves a test the tree never reports to tests-end-as-designed', () => {
    const tests = designed().filter(([title]) => title !== PAGE_TITLE_TEST)
    expect(judge([read], tests)).toEqual([])
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
  const HEADING = 'fails on the wrong heading'
  const MISSING = 'times out waiting for a missing element'
  const [AT_HEADING, AT_MISSING] = [HEADING, MISSING].map(scenarioIndex)

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
    commands[AT_MISSING] = { ...commands[AT_MISSING], error: undefined }
    expect(judge(designed(), commands)).toEqual([
      {
        rule: RULES.failedTestExplained,
        message: `"${MISSING}" failed but none of its 1 row(s) is a failed action`
      }
    ])
  })

  it('judges a test designed to fail even when the tree shows it passed', () => {
    const tests = designed()
    tests[AT_HEADING] = [HEADING, 'passed', AT_HEADING * 100]
    const commands = rows()
    commands[AT_HEADING] = { ...commands[AT_HEADING], error: undefined }
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
    commands[AT_MISSING] = {
      command: 'waitForElementVisible',
      args: ['#missing'],
      result: false,
      timestamp: AT_MISSING * 100 + 50
    }
    expect(judge(designed(), commands)).toEqual([])
  })

  // Python's timed-out WebDriverWait: its polls are unmapped findElement rows that error, as a passing wait's do.
  it('does not take an unmapped poll that errored for the failure', () => {
    const commands = rows()
    commands[AT_MISSING] = {
      command: 'findElement',
      args: [],
      timestamp: AT_MISSING * 100 + 50,
      error: { name: 'NoSuchElementError', message: 'no element #missing' }
    }
    expect(judge(designed(), commands).map((v) => v.rule)).toEqual([
      RULES.failedTestExplained
    ])
  })

  it('does not take a poll a passing wait retried past for the failure', () => {
    const commands = rows()
    const at = AT_MISSING * 100
    commands[AT_MISSING] = {
      command: 'waitUntil',
      args: [],
      id: 1,
      result: true,
      timestamp: at + 60
    }
    commands.push({
      command: 'getText',
      args: ['#missing'],
      id: 2,
      parentId: 1,
      timestamp: at + 50,
      error: ERROR
    })
    expect(judge(designed(), commands).map((v) => v.rule)).toEqual([
      RULES.failedTestExplained
    ])
  })

  it('places a row by the test its uid names, so an error stamped for one test explains no other', () => {
    const commands = rows()
    commands[AT_MISSING] = {
      ...commands[AT_MISSING],
      timestamp: 50,
      testUid: `t${AT_MISSING}`
    }
    commands[AT_HEADING] = { ...commands[AT_HEADING], testUid: 't0' }
    expect(judge(designed(), commands)).toEqual([
      expect.objectContaining({ rule: RULES.testHasRows }),
      expect.objectContaining({ rule: RULES.failedTestExplained })
    ])
  })

  it('leaves a test the tree never reports to tests-end-as-designed', () => {
    expect(judge(designed().slice(0, -1), rows().slice(0, -1))).toEqual([])
  })
})
