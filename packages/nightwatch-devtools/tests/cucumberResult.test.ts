import { describe, it, expect } from 'vitest'
import {
  closeOpenSteps,
  cucumberResultToTestState
} from '../src/helpers/cucumberResult.js'
import { TEST_STATE } from '../src/constants.js'
import type { SuiteStats, TestStats } from '../src/types.js'

function suiteWithSteps(stepStates: Array<TestStats['state']>): SuiteStats {
  return {
    uid: 's',
    cid: '0-0',
    title: 'scenario',
    fullTitle: 'scenario',
    file: '/f.feature',
    type: 'suite',
    state: TEST_STATE.RUNNING,
    start: new Date(),
    end: null,
    tests: stepStates.map((state, i) => ({
      uid: `t${i}`,
      cid: '0-0',
      title: `step ${i}`,
      fullTitle: `step ${i}`,
      parent: 's',
      state,
      start: new Date(),
      end: null,
      type: 'test' as const,
      file: '/f.feature',
      retries: 0,
      _duration: 0,
      hooks: []
    })),
    suites: [],
    hooks: [],
    _duration: 0
  }
}

describe('cucumberResultToTestState', () => {
  it('maps statuses to dashboard states (case-insensitive, everything-else → FAILED)', () => {
    expect(cucumberResultToTestState({ status: 'PASSED' })).toBe(
      TEST_STATE.PASSED
    )
    expect(cucumberResultToTestState({ status: 'skipped' })).toBe(
      TEST_STATE.SKIPPED
    )
    // FAILED / AMBIGUOUS / UNDEFINED / PENDING / UNKNOWN / unknown words all collapse to FAILED
    for (const s of [
      'FAILED',
      'AMBIGUOUS',
      'UNDEFINED',
      'PENDING',
      'mystery'
    ]) {
      expect(cucumberResultToTestState({ status: s })).toBe(TEST_STATE.FAILED)
    }
  })

  it('treats missing status / null / undefined as FAILED', () => {
    expect(cucumberResultToTestState({})).toBe(TEST_STATE.FAILED)
    expect(cucumberResultToTestState(null)).toBe(TEST_STATE.FAILED)
    expect(cucumberResultToTestState(undefined)).toBe(TEST_STATE.FAILED)
  })
})

describe('closeOpenSteps', () => {
  it('marks open steps PASSED when scenario passed and FAILED otherwise', () => {
    const passed = suiteWithSteps([TEST_STATE.RUNNING, TEST_STATE.PENDING])
    closeOpenSteps(passed, TEST_STATE.PASSED)
    expect((passed.tests as TestStats[]).map((t) => t.state)).toEqual([
      TEST_STATE.PASSED,
      TEST_STATE.PASSED
    ])

    const failed = suiteWithSteps([TEST_STATE.RUNNING, TEST_STATE.PENDING])
    closeOpenSteps(failed, TEST_STATE.FAILED)
    expect((failed.tests as TestStats[]).map((t) => t.state)).toEqual([
      TEST_STATE.FAILED,
      TEST_STATE.FAILED
    ])

    // SKIPPED scenario also treats open steps as FAILED — only PASSED clears them
    const skipped = suiteWithSteps([TEST_STATE.RUNNING])
    closeOpenSteps(skipped, TEST_STATE.SKIPPED)
    expect((skipped.tests[0] as TestStats).state).toBe(TEST_STATE.FAILED)
  })

  it('leaves terminal-state steps unchanged and stamps end timestamp on closed steps', () => {
    const suite = suiteWithSteps([
      TEST_STATE.PASSED,
      TEST_STATE.FAILED,
      TEST_STATE.RUNNING
    ])
    const ts = new Date(123456789)
    closeOpenSteps(suite, TEST_STATE.PASSED, ts)
    // First two unchanged
    expect((suite.tests[0] as TestStats).state).toBe(TEST_STATE.PASSED)
    expect((suite.tests[1] as TestStats).state).toBe(TEST_STATE.FAILED)
    // Third closed at our timestamp
    expect((suite.tests[2] as TestStats).end).toBe(ts)
  })

  it('skips non-TestStats entries (defensive against legacy string-only arrays)', () => {
    const suite = suiteWithSteps([TEST_STATE.RUNNING])
    suite.tests.push('legacy' as unknown as TestStats)
    closeOpenSteps(suite, TEST_STATE.PASSED)
    expect(suite.tests[1]).toBe('legacy')
  })
})
