import { describe, it, expect } from 'vitest'
import {
  computeSuiteFinalStatePermissive,
  computeSuiteFinalStateStrict,
  computeSuiteRunningState,
  createSuiteStats,
  createTestStats,
  stampSuiteEnd,
  stampTestEnd
} from '../src/suite-helpers.js'
import type { SuiteStats, TestStats } from '@wdio/devtools-shared'
import { TEST_STATE } from '@wdio/devtools-shared'

function suiteWith(tests: TestStats[], nested: SuiteStats[] = []): SuiteStats {
  const s = createSuiteStats({ uid: 's', title: 'S', file: '/f' })
  s.tests = tests
  s.suites = nested
  return s
}

function test(state: TestStats['state']): TestStats {
  return createTestStats({
    uid: 't',
    title: 't',
    file: '/f',
    parent: 's',
    state
  })
}

describe('createSuiteStats', () => {
  it('applies the standard defaults', () => {
    const s = createSuiteStats({ uid: 'a', title: 'A', file: '/x' })
    expect(s).toMatchObject({
      uid: 'a',
      cid: '0-0',
      type: 'suite',
      state: TEST_STATE.RUNNING,
      end: null,
      tests: [],
      suites: [],
      hooks: []
    })
    expect(s.start).toBeInstanceOf(Date)
  })

  it('honors callSource / featureFile / parent overrides', () => {
    const s = createSuiteStats({
      uid: 'a',
      title: 'A',
      file: '/x',
      callSource: '/x:5',
      featureFile: '/x.feature',
      parent: 'root'
    })
    expect(s.callSource).toBe('/x:5')
    expect(s.featureFile).toBe('/x.feature')
    expect(s.parent).toBe('root')
  })
})

describe('createTestStats', () => {
  it('uses title as fullTitle when not overridden', () => {
    const t = createTestStats({ uid: 't', title: 'T', file: '/x', parent: 'p' })
    expect(t.fullTitle).toBe('T')
    expect(t.type).toBe('test')
    expect(t.retries).toBe(0)
  })

  it('honors fullTitle override', () => {
    const t = createTestStats({
      uid: 't',
      title: 'short',
      fullTitle: 'parent suite > short',
      file: '/x',
      parent: 'p'
    })
    expect(t.fullTitle).toBe('parent suite > short')
  })
})

describe('computeSuiteFinalStatePermissive', () => {
  it('returns FAILED if any direct test failed', () => {
    expect(
      computeSuiteFinalStatePermissive(
        suiteWith([test(TEST_STATE.PASSED), test(TEST_STATE.FAILED)])
      )
    ).toBe(TEST_STATE.FAILED)
  })

  it('returns FAILED if any nested suite failed', () => {
    const nested = suiteWith([])
    nested.state = TEST_STATE.FAILED
    expect(computeSuiteFinalStatePermissive(suiteWith([], [nested]))).toBe(
      TEST_STATE.FAILED
    )
  })

  it('returns PASSED otherwise — even with RUNNING tests', () => {
    expect(
      computeSuiteFinalStatePermissive(
        suiteWith([test(TEST_STATE.PASSED), test(TEST_STATE.RUNNING)])
      )
    ).toBe(TEST_STATE.PASSED)
  })
})

describe('computeSuiteFinalStateStrict', () => {
  it('returns FAILED on any failure', () => {
    expect(
      computeSuiteFinalStateStrict(
        suiteWith([test(TEST_STATE.PASSED), test(TEST_STATE.FAILED)])
      )
    ).toBe(TEST_STATE.FAILED)
  })

  it('returns PASSED for empty suite', () => {
    expect(computeSuiteFinalStateStrict(suiteWith([]))).toBe(TEST_STATE.PASSED)
  })

  it('returns FAILED for orphaned RUNNING tests (the strictness)', () => {
    expect(
      computeSuiteFinalStateStrict(suiteWith([test(TEST_STATE.RUNNING)]))
    ).toBe(TEST_STATE.FAILED)
  })

  it('returns PASSED when all passed/skipped', () => {
    expect(
      computeSuiteFinalStateStrict(
        suiteWith([test(TEST_STATE.PASSED), test(TEST_STATE.SKIPPED)])
      )
    ).toBe(TEST_STATE.PASSED)
  })
})

describe('computeSuiteRunningState', () => {
  it('FAILED if any failed', () => {
    expect(computeSuiteRunningState(suiteWith([test(TEST_STATE.FAILED)]))).toBe(
      TEST_STATE.FAILED
    )
  })

  it('RUNNING if any direct test is RUNNING', () => {
    expect(
      computeSuiteRunningState(suiteWith([test(TEST_STATE.RUNNING)]))
    ).toBe(TEST_STATE.RUNNING)
  })

  it('RUNNING if any nested suite has no end timestamp', () => {
    const nested = suiteWith([])
    nested.state = TEST_STATE.PASSED // state lies; end:null is the signal
    expect(computeSuiteRunningState(suiteWith([], [nested]))).toBe(
      TEST_STATE.RUNNING
    )
  })

  it('PASSED when everything is finished and nobody failed', () => {
    const passed = test(TEST_STATE.PASSED)
    const nested = suiteWith([])
    nested.state = TEST_STATE.PASSED
    nested.end = new Date()
    expect(computeSuiteRunningState(suiteWith([passed], [nested]))).toBe(
      TEST_STATE.PASSED
    )
  })
})

describe('stampSuiteEnd', () => {
  it('sets end and _duration relative to start', () => {
    const start = new Date(1000)
    const s = createSuiteStats({ uid: 'a', title: 'A', file: '/f', start })
    stampSuiteEnd(s, new Date(2500))
    expect(s.end?.getTime()).toBe(2500)
    expect(s._duration).toBe(1500)
  })

  it('zero duration when end equals start', () => {
    const start = new Date(1000)
    const s = createSuiteStats({ uid: 'a', title: 'A', file: '/f', start })
    stampSuiteEnd(s, new Date(1000))
    expect(s._duration).toBe(0)
  })
})

describe('stampTestEnd', () => {
  it('sets end and _duration relative to start', () => {
    const start = new Date(500)
    const t = createTestStats({
      uid: 't',
      title: 'T',
      file: '/f',
      parent: 'p',
      start
    })
    stampTestEnd(t, new Date(800))
    expect(t.end?.getTime()).toBe(800)
    expect(t._duration).toBe(300)
  })
})
