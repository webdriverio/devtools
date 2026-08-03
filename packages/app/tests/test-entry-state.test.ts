import { describe, it, expect } from 'vitest'

import {
  computeEntryState,
  getTestEntry
} from '../src/components/sidebar/test-entry-state.js'
import type { TestEntry } from '../src/components/sidebar/types.js'
import type {
  SuiteStatsFragment,
  TestStatsFragment
} from '../src/controller/types.js'

const SPEC_FILE = '/repo/test/checkout.e2e.ts'
const FINISHED_AT = new Date(1_700_000_000_000)

// Fragments are cast through `as never` for the same reason as
// suite-merge.test.ts: the declared shapes come from @wdio/reporter, and these
// specs need the off-contract values real payloads carry — a suite whose state
// is null, a state string the sidebar has no rendering for, a missing `tests`
// key.
const test = (
  uid: string,
  overrides: Record<string, unknown> = {}
): TestStatsFragment =>
  ({
    uid,
    title: uid,
    fullTitle: uid,
    file: SPEC_FILE,
    ...overrides
  }) as never as TestStatsFragment

/** No `state` by default: a suite carrying one is answered from that state, so
 *  the derive-from-children path is only reachable from a stateless suite —
 *  which is also what the backend sends. */
const suite = (
  uid: string,
  overrides: Record<string, unknown> = {}
): SuiteStatsFragment =>
  ({
    uid,
    title: uid,
    fullTitle: uid,
    file: SPEC_FILE,
    tests: [],
    suites: [],
    ...overrides
  }) as never as SuiteStatsFragment

const passed = (uid: string) => test(uid, { state: 'passed', end: FINISHED_AT })
const failed = (uid: string) => test(uid, { state: 'failed', end: FINISHED_AT })
const skipped = (uid: string) => test(uid, { state: 'skipped' })
const running = (uid: string) => test(uid, { state: 'running' })
const queued = (uid: string) => test(uid, { state: 'pending' })

const keepAll = () => true

/**
 * `computeEntryState` is the sidebar's mapping of a shared outcome onto a row
 * status — the outcome derivation itself, and the truth table every consumer
 * agrees on, live in `test-outcome.test.ts`. These specs cover the mapping and
 * the two statuses only the tree has a name for.
 */
describe('computeEntryState', () => {
  describe('suite', () => {
    it('spins for a running test even over a stale terminal suite state', () => {
      // A rerun clears end times but not the cached 'passed' on the suite.
      expect(
        computeEntryState(
          suite('s', { state: 'passed', tests: [running('t')] })
        )
      ).toBe('running')
    })

    it('spins for a suite marked pending even when its children are terminal', () => {
      expect(
        computeEntryState(
          suite('s', { state: 'pending', tests: [passed('t1'), failed('t2')] })
        )
      ).toBe('running')
    })

    it('spins for a suite marked running whose child never started', () => {
      expect(
        computeEntryState(suite('s', { state: 'running', tests: [test('t')] }))
      ).toBe('running')
    })

    it('derives failed from a failed test when the suite carries no state', () => {
      expect(
        computeEntryState(suite('s', { tests: [passed('t1'), failed('t2')] }))
      ).toBe('failed')
    })

    it('derives failed from a failure in a nested suite', () => {
      const inner = suite('inner', { tests: [failed('t')] })
      expect(
        computeEntryState(
          suite('outer', { tests: [passed('t1')], suites: [inner] })
        )
      ).toBe('failed')
    })

    it('derives passed when something passed and no descendant failed', () => {
      const inner = suite('inner', { tests: [skipped('t')] })
      expect(
        computeEntryState(
          suite('outer', { tests: [passed('t1')], suites: [inner] })
        )
      ).toBe('passed')
    })

    it('derives skipped for a suite that only ever skipped', () => {
      expect(
        computeEntryState(suite('s', { tests: [skipped('t1'), skipped('t2')] }))
      ).toBe('skipped')
    })

    it('returns its own state before consulting its children', () => {
      expect(
        computeEntryState(suite('s', { state: 'passed', tests: [failed('t')] }))
      ).toBe('passed')
      expect(
        computeEntryState(suite('s', { state: 'failed', tests: [passed('t')] }))
      ).toBe('failed')
      expect(
        computeEntryState(
          suite('s', { state: 'skipped', tests: [failed('t')] })
        )
      ).toBe('skipped')
    })

    it('derives from its children when its own state is one it cannot render', () => {
      expect(
        computeEntryState(
          suite('s', { state: 'aborted', tests: [failed('t')] })
        )
      ).toBe('failed')
      expect(
        computeEntryState(
          suite('s', { state: 'aborted', tests: [passed('t')] })
        )
      ).toBe('passed')
    })

    it('shows a suite nothing has reported on as not run, null state or no state', () => {
      // The summary calls this same run 'idle'; a green check here was the
      // divergence the shared derivation removed.
      const child = test('t')
      expect(computeEntryState(suite('s', { tests: [child] }))).toBe('pending')
      expect(
        computeEntryState(suite('s', { state: null, tests: [child] }))
      ).toBe('pending')
    })

    it('shows an empty suite as not run', () => {
      expect(computeEntryState(suite('s'))).toBe('pending')
      expect(computeEntryState(suite('s', { state: null }))).toBe('pending')
      expect(
        computeEntryState(suite('s', { tests: undefined, suites: undefined }))
      ).toBe('pending')
    })
  })

  describe('leaf test', () => {
    it('maps every reported state onto the sidebar status', () => {
      expect(computeEntryState(passed('t'))).toBe('passed')
      expect(computeEntryState(failed('t'))).toBe('failed')
      expect(computeEntryState(skipped('t'))).toBe('skipped')
      expect(computeEntryState(running('t'))).toBe('running')
    })

    it('spins for a queued test rather than showing it as never run', () => {
      expect(computeEntryState(queued('t'))).toBe('running')
    })

    it('passes a test that finished without a reported state', () => {
      expect(computeEntryState(test('t', { end: FINISHED_AT }))).toBe('passed')
    })

    it('leaves a test that never started pending', () => {
      expect(computeEntryState(test('t'))).toBe('pending')
    })

    it('falls back to the end stamp for a state it has no entry for', () => {
      expect(
        computeEntryState(test('t', { state: 'aborted', end: FINISHED_AT }))
      ).toBe('passed')
      expect(computeEntryState(test('t', { state: 'aborted' }))).toBe('pending')
    })
  })
})

describe('getTestEntry', () => {
  it('maps a leaf test onto a childless test entry', () => {
    const entry = getTestEntry(
      test('t', {
        title: 'applies a discount code',
        fullTitle: 'Checkout flow applies a discount code',
        state: 'failed',
        end: FINISHED_AT,
        callSource: 'checkout.e2e.ts:24:5',
        featureFile: '/repo/test/checkout.feature',
        featureLine: 12
      }),
      keepAll
    )

    expect(entry).toEqual({
      uid: 't',
      label: 'applies a discount code',
      type: 'test',
      state: 'failed',
      callSource: 'checkout.e2e.ts:24:5',
      specFile: SPEC_FILE,
      fullTitle: 'Checkout flow applies a discount code',
      featureFile: '/repo/test/checkout.feature',
      featureLine: 12,
      children: []
    })
  })

  it('falls back from a missing fullTitle to the title', () => {
    expect(
      getTestEntry(
        test('t', { title: 'signs in', fullTitle: undefined }),
        keepAll
      ).fullTitle
    ).toBe('signs in')
  })

  it('leaves the label empty when the test has no title', () => {
    const entry = getTestEntry(
      test('t', { title: undefined, fullTitle: undefined }),
      keepAll
    )
    expect(entry.label).toBe('')
    expect(entry.fullTitle).toBeUndefined()
  })

  it('derives the state of the entry rather than copying the fragment', () => {
    expect(getTestEntry(test('t'), keepAll).state).toBe('pending')
    expect(getTestEntry(queued('t'), keepAll).state).toBe('running')
  })

  it('maps a suite onto a suite entry holding its tests', () => {
    const entry = getTestEntry(
      suite('checkout-suite', {
        title: 'Checkout flow',
        tests: [passed('t1'), failed('t2')]
      }),
      keepAll
    )

    expect(entry).toMatchObject({
      uid: 'checkout-suite',
      label: 'Checkout flow',
      fullTitle: 'Checkout flow',
      type: 'suite',
      suiteType: 'suite',
      state: 'failed',
      specFile: SPEC_FILE
    })
    expect(entry.children.map((child) => child.uid)).toEqual(['t1', 't2'])
  })

  it('leaves a suite label empty when the suite has no title', () => {
    const entry = getTestEntry(suite('s', { title: undefined }), keepAll)
    expect(entry.label).toBe('')
    expect(entry.fullTitle).toBe('')
  })

  it('keeps the suite type reported for a suite with only tests', () => {
    expect(
      getTestEntry(
        suite('login-scenario', { type: 'scenario', tests: [passed('t')] }),
        keepAll
      ).suiteType
    ).toBe('scenario')
  })

  it('tags a suite that holds suites as a feature whatever its own type says', () => {
    const scenario = suite('login-scenario', {
      type: 'scenario',
      tests: [passed('t')]
    })
    expect(
      getTestEntry(
        suite('login-feature', { type: 'scenario', suites: [scenario] }),
        keepAll
      ).suiteType
    ).toBe('feature')
  })

  it('orders tests before nested suites', () => {
    const inner = suite('inner', { tests: [passed('t2')] })
    const entry = getTestEntry(
      suite('outer', { tests: [passed('t1')], suites: [inner] }),
      keepAll
    )

    expect(entry.children.map((child) => child.uid)).toEqual(['t1', 'inner'])
    expect(entry.children.map((child) => child.type)).toEqual(['test', 'suite'])
  })

  it('maps a grandchild test through both levels', () => {
    const inner = suite('login-scenario', {
      type: 'scenario',
      tests: [failed('login-invalid')]
    })
    const entry = getTestEntry(
      suite('login-feature', { suites: [inner] }),
      keepAll
    )

    expect(entry.state).toBe('failed')
    expect(entry.children[0]?.state).toBe('failed')
    expect(entry.children[0]?.children[0]).toMatchObject({
      uid: 'login-invalid',
      type: 'test',
      state: 'failed'
    })
  })

  it('drops the children the filter rejects and keeps the suite', () => {
    const entry = getTestEntry(
      suite('s', { tests: [passed('keep'), passed('drop')] }),
      (child) => child.uid === 'keep'
    )

    expect(entry.children.map((child) => child.uid)).toEqual(['keep'])
  })

  it('filters nested suites at every level', () => {
    const inner = suite('inner', { tests: [passed('keep'), passed('drop')] })
    const entry = getTestEntry(
      suite('outer', { suites: [inner] }),
      (child) => child.uid !== 'drop'
    )

    expect(entry.children[0]?.children.map((child) => child.uid)).toEqual([
      'keep'
    ])
  })

  it('offers the filter the mapped entry, and never the entry it was called on', () => {
    const seen: TestEntry[] = []
    const root = suite('s', { tests: [passed('t1')] })

    getTestEntry(root, (child) => {
      seen.push(child)
      return true
    })

    expect(seen.map((entry) => entry.uid)).toEqual(['t1'])
    expect(seen[0]).toMatchObject({ uid: 't1', type: 'test', state: 'passed' })
  })

  it('keeps a suite whose every child was filtered out, with no children left', () => {
    const entry = getTestEntry(
      suite('s', { tests: [passed('t1')] }),
      () => false
    )

    expect(entry.uid).toBe('s')
    expect(entry.children).toEqual([])
  })
})
