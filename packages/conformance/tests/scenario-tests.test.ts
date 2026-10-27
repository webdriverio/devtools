import { describe, expect, it } from 'vitest'

import { RULES, SCENARIO_TESTS } from '../src/constants.js'
import {
  checkTestOutcomes,
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
