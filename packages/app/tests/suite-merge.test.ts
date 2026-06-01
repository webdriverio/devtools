import { describe, it, expect } from 'vitest'

import {
  canonicalKey,
  canonicalizeUids,
  mergeTests,
  mergeChildSuites,
  mergeSuite,
  type MergeContext
} from '../src/controller/suite-merge.js'
import type {
  SuiteStatsFragment,
  TestStatsFragment
} from '../src/controller/types.js'

const ctx = (override: Partial<MergeContext> = {}): MergeContext => ({
  activeRerunTestUid: undefined,
  activeRerunSuiteUid: undefined,
  ...override
})

const test = (
  uid: string,
  overrides: Partial<TestStatsFragment> = {}
): TestStatsFragment => ({
  uid,
  title: uid,
  fullTitle: uid,
  state: 'passed',
  start: 1000,
  end: 2000,
  ...overrides
}) as TestStatsFragment

const suite = (
  uid: string,
  overrides: Partial<SuiteStatsFragment> = {}
): SuiteStatsFragment => ({
  uid,
  title: uid,
  fullTitle: uid,
  state: 'passed',
  start: 1000,
  end: 2000,
  tests: [],
  suites: [],
  ...overrides
}) as SuiteStatsFragment

describe('canonicalKey', () => {
  it('builds a stable key from file + featureLine + fullTitle', () => {
    expect(
      canonicalKey({
        uid: 'a',
        file: '/path/login.feature',
        featureFile: '/path/login.feature',
        featureLine: 5,
        fullTitle: 'logs in'
      } as TestStatsFragment)
    ).toBe('/path/login.feature::/path/login.feature:5::logs in')
  })

  it('returns undefined when there is nothing to key on', () => {
    expect(
      canonicalKey({ uid: 'a' } as TestStatsFragment)
    ).toBeUndefined()
  })

  it('falls back from fullTitle to title', () => {
    expect(
      canonicalKey({
        uid: 'a',
        file: '/x.ts',
        title: 'fallback'
      } as TestStatsFragment)
    ).toBe('/x.ts:::::fallback')
  })
})

describe('canonicalizeUids', () => {
  it('rewrites incoming uid to existing uid when canonical keys match', () => {
    const prev = [test('old-uid', { file: '/a.ts', fullTitle: 'login' })]
    const next = [test('new-uid', { file: '/a.ts', fullTitle: 'login' })]
    const result = canonicalizeUids(prev, next)
    expect(result[0]?.uid).toBe('old-uid')
  })

  it('leaves uid alone when canonical key does not match', () => {
    const prev = [test('old', { file: '/a.ts', fullTitle: 'login' })]
    const next = [test('new', { file: '/b.ts', fullTitle: 'logout' })]
    expect(canonicalizeUids(prev, next)[0]?.uid).toBe('new')
  })

  it('short-circuits when either side is empty', () => {
    expect(canonicalizeUids([], [test('x')])).toEqual([test('x')])
    expect(canonicalizeUids([test('x')], [])).toEqual([])
  })
})

describe('mergeTests', () => {
  it('replaces a test on rerun (different start time)', () => {
    const prev = [test('t1', { state: 'failed', start: 1000, end: 2000 })]
    const next = [test('t1', { state: 'passed', start: 5000, end: 6000 })]
    const merged = mergeTests(prev, next, ctx())
    expect(merged[0]?.state).toBe('passed')
    expect(merged[0]?.start).toBe(5000)
  })

  it('shallow-merges when start times match (normal update)', () => {
    const prev = [test('t1', { state: 'running', start: 1000, end: undefined })]
    const next = [test('t1', { state: 'passed', start: 1000, end: 2000 })]
    const merged = mergeTests(prev, next, ctx())
    expect(merged[0]?.state).toBe('passed')
    expect(merged[0]?.end).toBe(2000)
  })

  it('freezes sibling tests during a single-test rerun', () => {
    const prev = [
      test('target', { state: 'failed', start: 1000 }),
      test('sibling', { state: 'passed', start: 1000 })
    ]
    const next = [
      test('target', { state: 'running', start: 5000 }),
      test('sibling', { state: 'pending', start: 5000 })
    ]
    const merged = mergeTests(
      prev,
      next,
      ctx({ activeRerunTestUid: 'target' })
    )
    const sibling = merged.find((t) => t.uid === 'sibling')!
    expect(sibling.state).toBe('passed')
    expect(sibling.start).toBe(1000)
  })

  it('preserves existing record when incoming test is pending on a rerun', () => {
    // Mid-rerun: backend sends all tests as 'pending' first. Untouched tests
    // must keep their previous results (state, end, start) so future updates
    // for this run still get detected as a rerun via start-time mismatch.
    const prev = [test('target', { state: 'failed', start: 1000, end: 2000 })]
    const next = [test('target', { state: 'pending', start: 5000 })]
    const merged = mergeTests(prev, next, ctx({ activeRerunTestUid: 'target' }))
    expect(merged[0]?.state).toBe('failed')
    expect(merged[0]?.start).toBe(1000)
    expect(merged[0]?.end).toBe(2000)
  })

  it('inserts a brand-new test', () => {
    expect(mergeTests([], [test('new')], ctx())[0]?.uid).toBe('new')
  })
})

describe('mergeSuite', () => {
  it('derives state="passed" only when all children are terminal', () => {
    const existing = suite('s', { state: undefined, tests: [], suites: [] })
    const incoming = suite('s', {
      state: undefined,
      tests: [test('t1', { state: 'passed' }), test('t2', { state: 'passed' })],
      suites: []
    })
    expect(mergeSuite(existing, incoming, ctx()).state).toBe('passed')
  })

  it('derives state="failed" when any child failed', () => {
    const existing = suite('s', { state: undefined, tests: [], suites: [] })
    const incoming = suite('s', {
      state: undefined,
      tests: [test('t1', { state: 'failed' }), test('t2', { state: 'passed' })],
      suites: []
    })
    expect(mergeSuite(existing, incoming, ctx()).state).toBe('failed')
  })

  it('keeps state="running" when children are still in-progress and incoming is pending', () => {
    const existing = suite('s', { state: 'passed', tests: [], suites: [] })
    const incoming = suite('s', {
      state: 'pending',
      tests: [test('t1', { state: 'running' })],
      suites: []
    })
    expect(mergeSuite(existing, incoming, ctx()).state).toBe('running')
  })

  it('marks stale child suites as pending on full-feature rerun', () => {
    // Feature suite re-emits with state='pending', no children yet. The stale
    // scenario suites from the previous run must show a spinner, not their
    // old passed/failed icons.
    const oldChild = suite('scenario-1', { state: 'passed' })
    const existing = suite('feature', { suites: [oldChild] })
    const incoming = suite('feature', {
      state: 'pending',
      tests: [],
      suites: [suite('scenario-1', { state: 'passed' })]
    })
    const merged = mergeSuite(existing, incoming, ctx())
    expect(merged.suites?.[0]?.state).toBe('pending')
    expect(merged.suites?.[0]?.end).toBeUndefined()
  })

  it('keeps sibling scenarios with their terminal state during a child-scenario rerun', () => {
    // Scenario 2 is being rerun; the feature suite is re-emitted with
    // state='pending' but scenario 1's state must stay 'passed'.
    const existing = suite('feature', {
      suites: [
        suite('scenario-1', { state: 'passed' }),
        suite('scenario-2', { state: 'failed' })
      ]
    })
    const incoming = suite('feature', {
      state: 'pending',
      suites: [
        suite('scenario-1', { state: 'passed' }),
        suite('scenario-2', { state: 'failed' })
      ]
    })
    const merged = mergeSuite(
      existing,
      incoming,
      ctx({ activeRerunSuiteUid: 'scenario-2' })
    )
    expect(merged.suites?.find((s) => s.uid === 'scenario-1')?.state).toBe(
      'passed'
    )
  })

  it('strips undefined/null state from incoming to preserve existing state', () => {
    const existing = suite('s', { state: 'passed' })
    const incoming = suite('s', {
      state: undefined as never,
      tests: [test('t', { state: 'passed' })]
    })
    // Existing state preserved because the merge derives 'passed' from
    // children (all terminal), but the key behavior is that incoming
    // state=undefined doesn't clobber existing 'passed'.
    expect(mergeSuite(existing, incoming, ctx()).state).toBe('passed')
  })
})

describe('mergeChildSuites', () => {
  it('combines existing + incoming suites by uid', () => {
    const existing = [suite('a'), suite('b')]
    const incoming = [suite('b', { state: 'failed' }), suite('c')]
    const merged = mergeChildSuites(existing, incoming, ctx())
    const uids = merged.map((s) => s.uid).sort()
    expect(uids).toEqual(['a', 'b', 'c'])
    expect(merged.find((s) => s.uid === 'b')?.state).toBe('failed')
  })

  it('canonicalizes uids before merging so rerun-renamed scenarios match', () => {
    const existing = [
      suite('original', { file: '/f.feature', fullTitle: 'A scenario' })
    ]
    const incoming = [
      suite('renamed', { file: '/f.feature', fullTitle: 'A scenario' })
    ]
    const merged = mergeChildSuites(existing, incoming, ctx())
    expect(merged).toHaveLength(1)
    expect(merged[0]?.uid).toBe('original')
  })
})
