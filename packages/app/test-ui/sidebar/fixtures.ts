// Suite trees for the sidebar specs. No two test titles share a distinctive
// word, and no suite title shares a word with its own tests — so a filter that
// keeps a suite whose children were all filtered out has exactly one
// explanation, and a status assertion has exactly one right answer.

import { TraceType } from '@wdio/devtools-shared'
import type { Metadata, TestStatus } from '@wdio/devtools-shared'

import type {
  SuiteStatsFragment,
  TestStatsFragment
} from '../../src/controller/types.js'
import type { ExplorerTestEntry } from '../../src/components/sidebar/test-suite.js'
import type { RunnerOptions } from '../../src/components/sidebar/types.js'

/** The sidebar only checks *whether* a test carries an `end` stamp, never its
 *  value, so one fixed stamp serves every fixture. */
export const FINISHED_AT = new Date(1_700_000_000_000)

export const SPEC_FILE = '/repo/test/checkout.e2e.ts'
export const CALL_SOURCE = 'checkout.e2e.ts:12:5'

/** Fragments whose title is guaranteed present, so specs build their expected
 *  row labels from the fixture instead of restating strings. */
export type NamedTest = TestStatsFragment & { title: string }
export type NamedSuite = SuiteStatsFragment & { title: string }

export function testFragment(
  uid: string,
  title: string,
  overrides: Omit<Partial<TestStatsFragment>, 'uid' | 'title'> = {}
): NamedTest {
  return { uid, title, fullTitle: title, file: SPEC_FILE, ...overrides }
}

/** `tests` is defaulted, not optional-by-omission: the sidebar tells a suite
 *  from a test with `'tests' in entry`, so a suite fragment missing the key is
 *  read as a leaf — no children, no `suiteType`. Real `SuiteStats` always
 *  carries the array. */
export function suiteFragment(
  uid: string,
  title: string,
  overrides: Omit<Partial<SuiteStatsFragment>, 'uid' | 'title'> = {}
): NamedSuite {
  return {
    uid,
    title,
    fullTitle: title,
    file: SPEC_FILE,
    tests: [],
    ...overrides
  }
}

/** The `suiteContext` value: the registry reaches the app as an array of
 *  uid-keyed chunks, and only a suite without a `parent` starts a tree. */
export function suiteRegistry(
  ...suites: SuiteStatsFragment[]
): Record<string, SuiteStatsFragment>[] {
  return [Object.fromEntries(suites.map((suite) => [suite.uid, suite]))]
}

const CHECKOUT_TITLE = 'Checkout flow'

const passing = testFragment('checkout-cart', 'adds an item to the cart', {
  fullTitle: `${CHECKOUT_TITLE} adds an item to the cart`,
  state: 'passed',
  callSource: CALL_SOURCE,
  end: FINISHED_AT
})

const failing = testFragment('checkout-discount', 'applies a discount code', {
  fullTitle: `${CHECKOUT_TITLE} applies a discount code`,
  state: 'failed',
  callSource: 'checkout.e2e.ts:24:5',
  end: FINISHED_AT
})

const running = testFragment('checkout-order', 'submits the order', {
  fullTitle: `${CHECKOUT_TITLE} submits the order`,
  state: 'running'
})

const skipped = testFragment('checkout-receipt', 'prints the receipt', {
  fullTitle: `${CHECKOUT_TITLE} prints the receipt`,
  state: 'skipped'
})

const checkoutSuite = suiteFragment('checkout-suite', CHECKOUT_TITLE, {
  tests: [passing, failing, running, skipped]
})

export interface MixedStateRun {
  registry: Record<string, SuiteStatsFragment>[]
  suite: NamedSuite
  passing: NamedTest
  failing: NamedTest
  running: NamedTest
  skipped: NamedTest
  /** Row labels top to bottom: the root suite, then its tests in registry
   *  order — the explorer renders tests before nested suites. */
  rowLabels: string[]
}

/** One root suite carrying every per-test state the sidebar can render. */
export const mixedStateRun: MixedStateRun = {
  registry: suiteRegistry(checkoutSuite),
  suite: checkoutSuite,
  passing,
  failing,
  running,
  skipped,
  rowLabels: [
    CHECKOUT_TITLE,
    passing.title,
    failing.title,
    running.title,
    skipped.title
  ]
}

/**
 * One root suite whose tests carry exactly the states listed, `undefined` for a
 * test that never started. The summary tallies leaf states and nothing else, so
 * a run it renders is fully described by its list of states — the titles are
 * generated because no summary assertion reads them.
 */
export function summaryRun(
  ...states: (TestStatus | undefined)[]
): Record<string, SuiteStatsFragment>[] {
  return suiteRegistry(
    suiteFragment('summary-suite', 'Checkout flow', {
      tests: states.map((state, index) =>
        testFragment(`summary-step-${index}`, `step ${index + 1}`, {
          ...(state ? { state } : {}),
          ...(state && state !== 'running' ? { end: FINISHED_AT } : {})
        })
      )
    })
  )
}

/** A second root with nothing failing and nothing running — the sibling a
 *  status or query filter is expected to drop entirely. */
export const profileSuite = suiteFragment('profile-suite', 'Profile page', {
  tests: [
    testFragment('profile-avatar', 'uploads an avatar', {
      state: 'passed',
      end: FINISHED_AT
    }),
    testFragment('profile-email', 'changes the email address', {
      state: 'passed',
      end: FINISHED_AT
    })
  ]
})

export interface NestedRun {
  registry: Record<string, SuiteStatsFragment>[]
  /** Root whose children are suites, which the tree tags as a feature. */
  feature: NamedSuite
  scenario: NamedSuite
  signsIn: NamedTest
  rejectsBadPassword: NamedTest
  rowLabels: string[]
}

const signsIn = testFragment('login-valid', 'signs in with valid credentials', {
  state: 'passed',
  end: FINISHED_AT
})

const rejectsBadPassword = testFragment(
  'login-invalid',
  'rejects a bad password',
  { state: 'passed', end: FINISHED_AT }
)

const scenarioSuite = suiteFragment('login-scenario', 'Sign in', {
  type: 'scenario',
  parent: 'Login feature',
  tests: [signsIn, rejectsBadPassword]
})

const featureSuite = suiteFragment('login-feature', 'Login feature', {
  suites: [scenarioSuite]
})

/** A two-level tree, registered flat the way the backend sends it: the nested
 *  scenario is its own registry entry and carries a `parent`. */
export const nestedRun: NestedRun = {
  registry: suiteRegistry(featureSuite, scenarioSuite),
  feature: featureSuite,
  scenario: scenarioSuite,
  signsIn,
  rejectsBadPassword,
  rowLabels: [
    featureSuite.title,
    scenarioSuite.title,
    signsIn.title,
    rejectsBadPassword.title
  ]
}

export const mochaRunnerOptions: RunnerOptions = {
  framework: 'mocha',
  configFilePath: '/repo/wdio.conf.ts',
  rerunCommand: 'npx wdio run wdio.conf.ts --spec',
  launchCommand: 'npm run test:e2e'
}

const runnerMetadata = (options: RunnerOptions): Metadata => ({
  type: TraceType.Testrunner,
  options
})

export const mochaMetadata = runnerMetadata(mochaRunnerOptions)

/** Cucumber drives its own steps, so a single test cannot be run alone. */
export const cucumberMetadata = runnerMetadata({ framework: 'cucumber' })

/** Nightwatch exposes no run-everything entry point. */
export const nightwatchMetadata = runnerMetadata({ framework: 'nightwatch' })

export type TestEntryProps = Partial<
  Pick<
    ExplorerTestEntry,
    | 'uid'
    | 'state'
    | 'labelText'
    | 'entryType'
    | 'callSource'
    | 'specFile'
    | 'fullTitle'
    | 'featureFile'
    | 'featureLine'
    | 'suiteType'
    | 'hasChildren'
    | 'selected'
    | 'root'
    | 'runDisabled'
    | 'runDisabledReason'
    | 'isCollapsed'
  >
>

/** Property bag for one `wdio-test-entry`. Defaulted to `mixedStateRun`'s
 *  passing row so the row specs and the explorer spec name the same test. */
export function entryProps(overrides: TestEntryProps = {}): TestEntryProps {
  return {
    uid: passing.uid,
    labelText: passing.title,
    fullTitle: passing.fullTitle,
    entryType: 'test',
    state: 'passed',
    specFile: SPEC_FILE,
    callSource: CALL_SOURCE,
    ...overrides
  }
}
