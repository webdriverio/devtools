import { describe, it, expect } from 'vitest'

import { computeEntryState } from '../src/components/sidebar/test-entry-state.js'
import {
  computeSuiteSummary,
  deriveRunStatus
} from '../src/components/sidebar/suite-summary.js'
import { markRunningAsStopped } from '../src/controller/mark-running.js'
import { mergeSuite } from '../src/controller/suite-merge.js'
import type {
  SuiteStatsFragment,
  TestStatsFragment
} from '../src/controller/types.js'
import {
  OUTCOME,
  deriveEntryOutcome,
  deriveGroupOutcome,
  deriveOutcome,
  emptyTally,
  hasFailure,
  hasInFlight,
  isInFlight,
  isSuiteEntry,
  settledOutcome,
  tallyOutcomes,
  type StateTally
} from '../src/utils/test-outcome.js'

const FINISHED_AT = new Date(1_700_000_000_000)

// Fragments are cast through `as never` for the same reason as
// suite-merge.test.ts: the declared shapes come from @wdio/reporter, and these
// specs need the off-contract values real payloads carry — a state of null, a
// state string no renderer has an entry for, a missing `tests` key.
const test = (
  uid: string,
  overrides: Record<string, unknown> = {}
): TestStatsFragment =>
  ({
    uid,
    title: uid,
    fullTitle: uid,
    ...overrides
  }) as never as TestStatsFragment

const suite = (
  uid: string,
  overrides: Record<string, unknown> = {}
): SuiteStatsFragment =>
  ({
    uid,
    title: uid,
    fullTitle: uid,
    tests: [],
    suites: [],
    ...overrides
  }) as never as SuiteStatsFragment

const passed = (uid: string) => test(uid, { state: 'passed', end: FINISHED_AT })
const failed = (uid: string) => test(uid, { state: 'failed', end: FINISHED_AT })
/** A skipped test carries no `end` — `TestStats.skip()` never calls
 *  `complete()`, so nothing but its state says it settled. */
const skipped = (uid: string) => test(uid, { state: 'skipped' })
const running = (uid: string) => test(uid, { state: 'running' })
const queued = (uid: string) => test(uid, { state: 'pending' })
const unreported = (uid: string) => test(uid)

const tally = (overrides: Partial<StateTally>): StateTally => ({
  ...emptyTally(),
  ...overrides
})

/**
 * The rows of the truth table, each naming the children of one stateless suite.
 * Every derivation in the app is asserted against the same rows below, which is
 * the point of the exercise: they used to disagree.
 */
const ROWS = {
  allPassed: [passed('a'), passed('b')],
  anyFailed: [passed('a'), failed('b')],
  allSkipped: [skipped('a'), skipped('b')],
  unreported: [unreported('a'), unreported('b')],
  empty: [] as TestStatsFragment[],
  running: [passed('a'), running('b')],
  allQueued: [queued('a'), queued('b')],
  queuedAfterFinished: [passed('a'), queued('b')],
  skippedAndPassed: [passed('a'), skipped('b')],
  skippedAndFailed: [failed('a'), skipped('b')]
}

describe('deriveEntryOutcome', () => {
  describe('leaf test', () => {
    it('reads a reported outcome straight off the state', () => {
      expect(deriveEntryOutcome(passed('t'))).toBe(OUTCOME.PASSED)
      expect(deriveEntryOutcome(failed('t'))).toBe(OUTCOME.FAILED)
      expect(deriveEntryOutcome(skipped('t'))).toBe(OUTCOME.SKIPPED)
      expect(deriveEntryOutcome(running('t'))).toBe(OUTCOME.RUNNING)
    })

    it('reads a reported pending state as queued, not as never-run', () => {
      expect(deriveEntryOutcome(queued('t'))).toBe(OUTCOME.QUEUED)
    })

    it('is idle for a test nothing has reported on', () => {
      expect(deriveEntryOutcome(unreported('t'))).toBe(OUTCOME.IDLE)
    })

    it('falls back to the end stamp for a state it has no entry for', () => {
      expect(
        deriveEntryOutcome(test('t', { state: 'aborted', end: FINISHED_AT }))
      ).toBe(OUTCOME.PASSED)
      expect(deriveEntryOutcome(test('t', { state: 'aborted' }))).toBe(
        OUTCOME.IDLE
      )
    })
  })

  describe('suite', () => {
    it('derives every truth-table row from its children', () => {
      const outcomes = Object.fromEntries(
        Object.entries(ROWS).map(([name, tests]) => [
          name,
          deriveEntryOutcome(suite('s', { tests }))
        ])
      )

      expect(outcomes).toEqual({
        allPassed: OUTCOME.PASSED,
        anyFailed: OUTCOME.FAILED,
        allSkipped: OUTCOME.SKIPPED,
        unreported: OUTCOME.IDLE,
        empty: OUTCOME.IDLE,
        running: OUTCOME.RUNNING,
        // Every run's first frame: the reporter announces its tests as pending
        // before the first one executes. The leaves spin, so the suite holding
        // them cannot show the not-run circle.
        allQueued: OUTCOME.RUNNING,
        queuedAfterFinished: OUTCOME.RUNNING,
        skippedAndPassed: OUTCOME.PASSED,
        skippedAndFailed: OUTCOME.FAILED
      })
    })

    it('reports its own terminal state over its children', () => {
      expect(
        deriveEntryOutcome(
          suite('s', { state: 'passed', tests: [failed('t')] })
        )
      ).toBe(OUTCOME.PASSED)
      expect(
        deriveEntryOutcome(
          suite('s', { state: 'failed', tests: [passed('t')] })
        )
      ).toBe(OUTCOME.FAILED)
    })

    it('runs while a child runs, whatever stale state it carries', () => {
      // A rerun clears end stamps but not the previous run's suite state.
      expect(
        deriveEntryOutcome(
          suite('s', { state: 'passed', tests: [running('t')] })
        )
      ).toBe(OUTCOME.RUNNING)
    })

    it('runs when its own state says a new run is starting', () => {
      expect(
        deriveEntryOutcome(
          suite('s', { state: 'pending', tests: [passed('a'), failed('b')] })
        )
      ).toBe(OUTCOME.RUNNING)
    })

    it('runs while a test inside a nested suite runs', () => {
      const inner = suite('inner', { state: 'passed', tests: [running('t')] })
      expect(deriveEntryOutcome(suite('outer', { suites: [inner] }))).toBe(
        OUTCOME.RUNNING
      )
    })

    it('fails from a failure two levels down', () => {
      const leaf = suite('leaf', { tests: [failed('t')] })
      const middle = suite('middle', { suites: [leaf] })
      expect(deriveEntryOutcome(suite('outer', { suites: [middle] }))).toBe(
        OUTCOME.FAILED
      )
    })

    it('treats a null state the same as an absent one', () => {
      expect(
        deriveEntryOutcome(suite('s', { state: null, tests: [passed('t')] }))
      ).toBe(OUTCOME.PASSED)
      expect(
        deriveEntryOutcome(
          suite('s', { state: null, tests: [unreported('t')] })
        )
      ).toBe(OUTCOME.IDLE)
    })

    it('derives from its children when its own state is one it cannot render', () => {
      expect(
        deriveEntryOutcome(
          suite('s', { state: 'aborted', tests: [failed('t')] })
        )
      ).toBe(OUTCOME.FAILED)
    })

    it('is idle for a suite whose children keys are present but unset', () => {
      expect(
        deriveEntryOutcome(suite('s', { tests: undefined, suites: undefined }))
      ).toBe(OUTCOME.IDLE)
    })

    // An end stamp on a suite says its hooks finished, not that anything ran:
    // a `describe` whose tests were all filtered out still gets `suite:end`.
    // Calling that passed is the false green this module exists to prevent.
    it('has no verdict for an empty suite that carries an end stamp', () => {
      expect(deriveEntryOutcome(suite('s', { end: FINISHED_AT }))).toBe(
        OUTCOME.IDLE
      )
    })
  })
})

describe('isSuiteEntry', () => {
  it('reads either children key as a suite and neither as a leaf', () => {
    expect(isSuiteEntry(suite('s'))).toBe(true)
    expect(isSuiteEntry(suite('s', { tests: undefined }))).toBe(true)
    expect(isSuiteEntry(test('t'))).toBe(false)
  })
})

describe('isInFlight', () => {
  it('holds every entry that has not settled', () => {
    expect(isInFlight(running('t'))).toBe(true)
    expect(isInFlight(queued('t'))).toBe(true)
    expect(isInFlight(unreported('t'))).toBe(true)
  })

  it('releases every entry that reported an outcome', () => {
    expect(isInFlight(passed('t'))).toBe(false)
    expect(isInFlight(failed('t'))).toBe(false)
    // The regression this guards: a skipped test has settled even though it
    // carries no end stamp.
    expect(isInFlight(skipped('t'))).toBe(false)
  })
})

describe('tallyOutcomes', () => {
  // `queued` counts its own bucket: a reporter marking a test pending means the
  // run reached it, which reads as running above it — folding it into `pending`
  // (nothing reported at all) is what showed spinner leaves under a not-run
  // parent on every run's first frame.
  it('counts each outcome once, keeping queued apart from unreported', () => {
    expect(
      tallyOutcomes([
        passed('a'),
        failed('b'),
        running('c'),
        skipped('d'),
        queued('e'),
        unreported('f')
      ])
    ).toEqual(
      tally({
        passed: 1,
        failed: 1,
        running: 1,
        skipped: 1,
        queued: 1,
        pending: 1,
        total: 6
      })
    )
  })

  it('skips holes in the list instead of counting them', () => {
    expect(tallyOutcomes([passed('a'), undefined])).toEqual(
      tally({ passed: 1, total: 1 })
    )
  })

  it('counts a nested suite by the outcome of its own subtree', () => {
    const failing = suite('inner', { tests: [passed('a'), failed('b')] })
    expect(tallyOutcomes([passed('t'), failing])).toEqual(
      tally({ passed: 1, failed: 1, total: 2 })
    )
  })
})

describe('deriveOutcome', () => {
  it('is idle with nothing to go on', () => {
    expect(deriveOutcome(emptyTally())).toBe(OUTCOME.IDLE)
  })

  it('is idle when nothing has produced a result yet', () => {
    expect(deriveOutcome(tally({ pending: 3, total: 3 }))).toBe(OUTCOME.IDLE)
  })

  it('runs while anything runs, even beside a stale failure count', () => {
    expect(deriveOutcome(tally({ failed: 1, running: 1, total: 2 }))).toBe(
      OUTCOME.RUNNING
    )
  })

  it('runs when results and unfinished work coexist', () => {
    expect(deriveOutcome(tally({ passed: 2, pending: 1, total: 3 }))).toBe(
      OUTCOME.RUNNING
    )
  })

  it('fails on any failure once the run has finished', () => {
    expect(deriveOutcome(tally({ passed: 2, failed: 1, total: 3 }))).toBe(
      OUTCOME.FAILED
    )
    expect(deriveOutcome(tally({ skipped: 2, failed: 1, total: 3 }))).toBe(
      OUTCOME.FAILED
    )
  })

  it('passes when something passed and nothing failed', () => {
    expect(deriveOutcome(tally({ passed: 3, total: 3 }))).toBe(OUTCOME.PASSED)
    expect(deriveOutcome(tally({ passed: 1, skipped: 2, total: 3 }))).toBe(
      OUTCOME.PASSED
    )
  })

  it('is skipped when the run verified nothing at all', () => {
    // Reporting "passed" for a run that executed no assertions is a false
    // green: skipped is the only honest headline.
    expect(deriveOutcome(tally({ skipped: 3, total: 3 }))).toBe(OUTCOME.SKIPPED)
  })
})

describe('deriveGroupOutcome', () => {
  it('answers for a list of entries what deriveOutcome answers for its tally', () => {
    for (const tests of Object.values(ROWS)) {
      expect(deriveGroupOutcome(tests)).toBe(
        deriveOutcome(tallyOutcomes(tests))
      )
    }
  })
})

describe('hasFailure / hasInFlight', () => {
  it('flags a failure and nothing else', () => {
    expect(hasFailure(tally({ failed: 1, total: 1 }))).toBe(true)
    expect(hasFailure(tally({ passed: 1, skipped: 1, total: 2 }))).toBe(false)
  })

  it('flags running and pending work as still to come', () => {
    expect(hasInFlight(tally({ running: 1, total: 1 }))).toBe(true)
    expect(hasInFlight(tally({ pending: 1, total: 1 }))).toBe(true)
    expect(hasInFlight(tally({ passed: 1, skipped: 1, total: 2 }))).toBe(false)
    expect(hasInFlight(emptyTally())).toBe(false)
  })
})

describe('settledOutcome', () => {
  it('returns the verdict once every entry settled', () => {
    expect(settledOutcome(tally({ passed: 2, total: 2 }))).toBe(OUTCOME.PASSED)
    expect(settledOutcome(tally({ passed: 1, failed: 1, total: 2 }))).toBe(
      OUTCOME.FAILED
    )
    expect(settledOutcome(tally({ skipped: 2, total: 2 }))).toBe(
      OUTCOME.SKIPPED
    )
  })

  it('withholds a verdict while anything is unfinished or absent', () => {
    expect(
      settledOutcome(tally({ passed: 1, running: 1, total: 2 }))
    ).toBeUndefined()
    expect(
      settledOutcome(tally({ passed: 1, pending: 1, total: 2 }))
    ).toBeUndefined()
    expect(settledOutcome(tally({ pending: 2, total: 2 }))).toBeUndefined()
    expect(settledOutcome(emptyTally())).toBeUndefined()
  })
})

/**
 * The reason the helper exists: the sidebar row, the summary pill, the suite
 * merge and the stop handler used to derive "did this fail?" four different
 * ways. Each row of the truth table is asserted against all four at once, so a
 * future divergence fails here.
 */
describe('every consumer agrees on the truth table', () => {
  const registry = (fragment: SuiteStatsFragment) => [
    { [fragment.uid]: fragment }
  ]

  const rowStates = (tests: TestStatsFragment[]) => {
    const fragment = suite('s', { tests })
    const stopped = markRunningAsStopped(registry(fragment))
    const merged = mergeSuite(fragment, suite('s', { tests }), {})
    return {
      tree: computeEntryState(fragment),
      summary: deriveRunStatus(computeSuiteSummary(registry(fragment))),
      merged: merged.state,
      stoppedTests: (stopped[0]?.['s']?.tests ?? []).map((t) => t.state)
    }
  }

  it('calls an all-passing suite passed everywhere', () => {
    expect(rowStates(ROWS.allPassed)).toEqual({
      tree: 'passed',
      summary: 'passed',
      merged: 'passed',
      stoppedTests: ['passed', 'passed']
    })
  })

  it('calls a suite holding a failure failed everywhere', () => {
    expect(rowStates(ROWS.anyFailed)).toEqual({
      tree: 'failed',
      summary: 'failed',
      merged: 'failed',
      stoppedTests: ['passed', 'failed']
    })
  })

  it('calls an all-skipped suite skipped everywhere, and stopping it keeps it skipped', () => {
    expect(rowStates(ROWS.allSkipped)).toEqual({
      tree: 'skipped',
      summary: 'skipped',
      merged: 'skipped',
      stoppedTests: ['skipped', 'skipped']
    })
  })

  it('calls a suite nothing has reported on not-run in the tree and idle in the summary', () => {
    const states = rowStates(ROWS.unreported)
    expect(states.tree).toBe('pending')
    expect(states.summary).toBe('idle')
    // The merge is the one caller that writes rather than reads: an unreported
    // child means the run is mid-flight, so the suite it stores spins.
    expect(states.merged).toBe('running')
  })

  it('calls an empty suite not-run in the tree and idle in the summary', () => {
    const states = rowStates(ROWS.empty)
    expect(states.tree).toBe('pending')
    expect(states.summary).toBe('idle')
  })

  it('calls a suite with a running test running everywhere', () => {
    const states = rowStates(ROWS.running)
    expect(states.tree).toBe('running')
    expect(states.summary).toBe('running')
    expect(states.merged).toBe('running')
  })

  it('calls a suite whose queued test follows a finished one running everywhere', () => {
    const states = rowStates(ROWS.queuedAfterFinished)
    expect(states.tree).toBe('running')
    expect(states.summary).toBe('running')
    expect(states.merged).toBe('running')
  })

  it('calls a suite of passed and skipped tests passed everywhere', () => {
    expect(rowStates(ROWS.skippedAndPassed)).toEqual({
      tree: 'passed',
      summary: 'passed',
      merged: 'passed',
      stoppedTests: ['passed', 'skipped']
    })
  })

  it('calls a suite of failed and skipped tests failed everywhere', () => {
    expect(rowStates(ROWS.skippedAndFailed)).toEqual({
      tree: 'failed',
      summary: 'failed',
      merged: 'failed',
      stoppedTests: ['failed', 'skipped']
    })
  })
})
