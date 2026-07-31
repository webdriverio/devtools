import { TEST_STATE } from '@wdio/devtools-shared'
import type { TestStatus } from '@wdio/devtools-shared'

/**
 * The app's single answer to "how did this test or suite end up?". The sidebar
 * tree, the run summary card, the suite merge and the stop handler all read it
 * from here — four private copies used to disagree, so the same stateless suite
 * showed a green check in the tree and "Idle" in the summary.
 */

/** Structural shape of anything carrying an outcome: a leaf test, a suite, or a
 *  merged fragment. `null` state and `null` end are off-contract, but real
 *  reporter payloads carry both. */
export interface OutcomeEntry {
  state?: TestStatus | null
  end?: Date | number | null
  tests?: (OutcomeEntry | undefined)[]
  suites?: (OutcomeEntry | undefined)[]
}

export const OUTCOME = {
  PASSED: 'passed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  RUNNING: 'running',
  IDLE: 'idle',
  QUEUED: 'queued'
} as const

export type EntryOutcome = (typeof OUTCOME)[keyof typeof OUTCOME]

/** What a group of entries can settle on. `queued` is leaf-only: a reporter
 *  marking a test `pending` means the run reached it, which reads as running
 *  for anything above it. */
export type GroupOutcome = Exclude<EntryOutcome, typeof OUTCOME.QUEUED>

/** A verdict — the group ran and this is how it went. */
export type SettledOutcome = Exclude<
  GroupOutcome,
  typeof OUTCOME.RUNNING | typeof OUTCOME.IDLE
>

/** Reported states that speak for themselves. Anything else — unset, `null`,
 *  or a state this app has no rendering for — falls back to the `end` stamp. */
const REPORTED: Partial<Record<TestStatus, EntryOutcome>> = {
  [TEST_STATE.PASSED]: OUTCOME.PASSED,
  [TEST_STATE.FAILED]: OUTCOME.FAILED,
  [TEST_STATE.SKIPPED]: OUTCOME.SKIPPED,
  [TEST_STATE.RUNNING]: OUTCOME.RUNNING,
  [TEST_STATE.PENDING]: OUTCOME.QUEUED
}

export interface StateTally {
  passed: number
  failed: number
  running: number
  skipped: number
  pending: number
  total: number
}

export const emptyTally = (): StateTally => ({
  passed: 0,
  failed: 0,
  running: 0,
  skipped: 0,
  pending: 0,
  total: 0
})

/** Suite-shaped: it carries children arrays, however empty. A fragment missing
 *  both keys is a leaf. */
export function isSuiteEntry(entry: OutcomeEntry): boolean {
  return 'tests' in entry || 'suites' in entry
}

const childrenOf = (entry: OutcomeEntry): (OutcomeEntry | undefined)[] => [
  ...(entry.tests ?? []),
  ...(entry.suites ?? [])
]

/** An entry whose state nobody reported still counts as finished once it
 *  carries an end stamp. */
const byEndStamp = (entry: OutcomeEntry): EntryOutcome =>
  entry.end ? OUTCOME.PASSED : OUTCOME.IDLE

/**
 * One entry's outcome. A suite defers to its children where it has no usable
 * state of its own, and children still in flight outrank whatever state it
 * carries — a rerun clears end stamps but leaves the previous run's
 * `passed`/`failed` behind.
 */
export function deriveEntryOutcome(entry: OutcomeEntry): EntryOutcome {
  const reported = entry.state ? REPORTED[entry.state] : undefined
  if (!isSuiteEntry(entry)) {
    return reported ?? byEndStamp(entry)
  }
  const children = deriveGroupOutcome(childrenOf(entry))
  // `pending` on a suite is the backend announcing a new run: stale terminal
  // children must not flip it back to passed.
  if (children === OUTCOME.RUNNING || reported === OUTCOME.QUEUED) {
    return OUTCOME.RUNNING
  }
  if (reported) {
    return reported
  }
  return children === OUTCOME.IDLE ? byEndStamp(entry) : children
}

/** True until an entry settles: running, queued, or nothing reported yet. */
export function isInFlight(entry: OutcomeEntry): boolean {
  const outcome = deriveEntryOutcome(entry)
  return (
    outcome === OUTCOME.RUNNING ||
    outcome === OUTCOME.QUEUED ||
    outcome === OUTCOME.IDLE
  )
}

/** Count entries by outcome. Nullish entries are skipped, not counted — the
 *  registry can hold holes and they say nothing about the run. */
export function tallyOutcomes(
  entries: readonly (OutcomeEntry | undefined)[]
): StateTally {
  const tally = emptyTally()
  for (const entry of entries) {
    if (!entry) {
      continue
    }
    tally.total += 1
    switch (deriveEntryOutcome(entry)) {
      case OUTCOME.PASSED:
        tally.passed += 1
        break
      case OUTCOME.FAILED:
        tally.failed += 1
        break
      case OUTCOME.RUNNING:
        tally.running += 1
        break
      case OUTCOME.SKIPPED:
        tally.skipped += 1
        break
      default:
        // queued and idle both mean "no result to show yet".
        tally.pending += 1
    }
  }
  return tally
}

/**
 * The outcome of a counted group. Running outranks a stale terminal count (a
 * rerun keeps the old numbers until fresh results land); a group nothing has
 * reported on is idle rather than green; and a group that only ever skipped is
 * `skipped`, because reporting "passed" for a run that verified nothing reads
 * as a false green.
 */
export function deriveOutcome(tally: StateTally): GroupOutcome {
  if (tally.total === 0) {
    return OUTCOME.IDLE
  }
  const settled = tally.passed + tally.failed + tally.skipped
  if (tally.running > 0 || (tally.pending > 0 && settled > 0)) {
    return OUTCOME.RUNNING
  }
  if (settled === 0) {
    return OUTCOME.IDLE
  }
  if (tally.failed > 0) {
    return OUTCOME.FAILED
  }
  if (tally.passed > 0) {
    return OUTCOME.PASSED
  }
  return OUTCOME.SKIPPED
}

export function deriveGroupOutcome(
  entries: readonly (OutcomeEntry | undefined)[]
): GroupOutcome {
  return deriveOutcome(tallyOutcomes(entries))
}

/** The verdict of a group that has finished, or undefined while any part of it
 *  is still to come. */
export function settledOutcome(tally: StateTally): SettledOutcome | undefined {
  const outcome = deriveOutcome(tally)
  return outcome === OUTCOME.RUNNING || outcome === OUTCOME.IDLE
    ? undefined
    : outcome
}

/** Did anything in this group fail? */
export const hasFailure = (tally: StateTally): boolean => tally.failed > 0

/** Is anything in this group still to come — running, queued, or unreported? */
export const hasInFlight = (tally: StateTally): boolean =>
  tally.running + tally.pending > 0
