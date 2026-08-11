import { describe, it, expect } from 'vitest'
import {
  collectSuiteTestMetadata,
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

describe('collectSuiteTestMetadata', () => {
  function namedTest(
    uid: string,
    parent: string,
    overrides: Partial<TestStats> = {}
  ): TestStats {
    const t = createTestStats({
      uid,
      title: uid,
      fullTitle: `full ${uid}`,
      file: `/spec/${uid}.ts`,
      parent
    })
    return Object.assign(t, overrides)
  }

  it('walks nested suites and collects every test entry', () => {
    const root = createSuiteStats({
      uid: 'root',
      title: 'Root',
      file: '/spec/a.ts'
    })
    const child = createSuiteStats({
      uid: 'child',
      title: 'Child',
      file: '/spec/a.ts'
    })
    root.tests = [namedTest('t1', 'root')]
    child.tests = [namedTest('t2', 'child')]
    root.suites = [child]

    const map = collectSuiteTestMetadata([root])
    expect([...map.keys()]).toEqual(['t1', 't2'])
    expect(map.get('t1')?.title).toBe('full t1')
    expect(map.get('t2')?.specFile).toBe('/spec/t2.ts')
  })

  it('walks multiple root suites from any iterable', () => {
    const a = createSuiteStats({ uid: 'a', title: 'A', file: '/a.ts' })
    const b = createSuiteStats({ uid: 'b', title: 'B', file: '/b.ts' })
    a.tests = [namedTest('t1', 'a')]
    b.tests = [namedTest('t2', 'b')]
    const map = collectSuiteTestMetadata(new Set([a, b]))
    expect(map.size).toBe(2)
  })

  it('carries state and attempt (from retries), defaulting attempt to 0', () => {
    const root = createSuiteStats({ uid: 'r', title: 'R', file: '/a.ts' })
    root.tests = [
      namedTest('flaky', 'r', { state: TEST_STATE.FAILED, retries: 2 }),
      namedTest('fresh', 'r', { state: TEST_STATE.PASSED })
    ]
    const map = collectSuiteTestMetadata([root])
    expect(map.get('flaky')).toMatchObject({ state: 'failed', attempt: 2 })
    expect(map.get('fresh')).toMatchObject({ state: 'passed', attempt: 0 })
  })

  it('prefers fullTitle, falling back to title, and suite file when entry file is missing', () => {
    const root = createSuiteStats({ uid: 'r', title: 'R', file: '/suite.ts' })
    const bare = namedTest('bare', 'r', { fullTitle: '' })
    // Simulate a partially-populated tree entry lacking `file`.
    delete (bare as { file?: string }).file
    root.tests = [bare]
    const map = collectSuiteTestMetadata([root])
    expect(map.get('bare')).toMatchObject({
      title: 'bare',
      specFile: '/suite.ts'
    })
  })

  it('records the ancestor chain outermost-first, excluding the test itself', () => {
    const outer = createSuiteStats({
      uid: 'outer',
      title: 'Outer',
      file: '/a.ts'
    })
    const mid = createSuiteStats({ uid: 'mid', title: 'Mid', file: '/a.ts' })
    const inner = createSuiteStats({
      uid: 'inner',
      title: 'Inner',
      file: '/a.ts'
    })
    inner.tests = [namedTest('t', 'inner')]
    mid.suites = [inner]
    outer.suites = [mid]

    const ancestry = collectSuiteTestMetadata([outer]).get('t')?.ancestry
    expect(ancestry).toEqual([
      { uid: 'outer', title: 'Outer', kind: 'suite' },
      { uid: 'mid', title: 'Mid', kind: 'suite' },
      { uid: 'inner', title: 'Inner', kind: 'suite' }
    ])
  })

  // Heuristic: a suite whose file ends with '.feature' (and isn't already
  // under a feature/scenario) is the feature; its direct child suites are
  // scenarios — matching the cucumber tree shape where scenario sub-suites
  // carry the same .feature file as their parent feature suite.
  it('derives feature/scenario kinds for a .feature-file tree', () => {
    const root = createSuiteStats({ uid: 'root', title: 'Root', file: '/cwd' })
    const feature = createSuiteStats({
      uid: 'feat',
      title: 'Login',
      file: '/features/login.feature'
    })
    const scenario = createSuiteStats({
      uid: 'scen',
      title: 'Valid creds',
      file: '/features/login.feature'
    })
    scenario.tests = [namedTest('step1', 'scen')]
    feature.suites = [scenario]
    root.suites = [feature]

    const ancestry = collectSuiteTestMetadata([root]).get('step1')?.ancestry
    expect(ancestry?.map((a) => a.kind)).toEqual([
      'suite',
      'feature',
      'scenario'
    ])
  })

  it('treats a top-level .feature suite as the feature', () => {
    const feature = createSuiteStats({
      uid: 'feat',
      title: 'Login',
      file: '/features/login.feature'
    })
    feature.tests = [namedTest('t', 'feat')]
    const ancestry = collectSuiteTestMetadata([feature]).get('t')?.ancestry
    expect(ancestry?.map((a) => a.kind)).toEqual(['feature'])
  })

  it('skips string placeholder entries', () => {
    const root = createSuiteStats({ uid: 'r', title: 'R', file: '/a.ts' })
    root.tests = ['placeholder-uid', namedTest('real', 'r')]
    const map = collectSuiteTestMetadata([root])
    expect(map.size).toBe(1)
    expect(map.has('real')).toBe(true)
  })
})
