// One preserve-and-rerun comparison, as the compare panel receives it: a login
// test that failed on a wrong password, preserved as a `PreservedAttempt`, and
// rerun successfully. The rerun reaches the panel as the *global* live command
// stream plus the live suite tree the panel windows that stream against — not
// as a second attempt — so the fixtures below model both halves separately.
//
// Builds on `./fixtures.js` (the shared login run) for the run origin, the demo
// URL, the spec path and the suite/test fragment builders.

import type {
  CommandLog,
  PreservedAttempt,
  PreservedStep
} from '@wdio/devtools-shared'

import type {
  SuiteStatsFragment,
  TestStatsFragment
} from '@/controller/types.js'

import { commandLog } from '../../support/builders.js'
import {
  LOGIN_URL,
  RUN_START,
  SPEC_FILE,
  suiteFragment,
  suiteRegistry,
  testFragment
} from './fixtures.js'

/** The uid the baseline was preserved under — a **suite** uid, so its live steps
 *  are the whole suite's tests. `LIVE_TEST_UID` covers the other shape: a test
 *  uid, which is what preserving from a test row records. */
export const SELECTED_UID = 'login-suite'
export const LIVE_TEST_UID = 'login-valid'
export const LIVE_TEST_TITLE = 'login page logs in with valid credentials'

/** The rerun starts a minute after the preserved attempt, so a fixture can tell
 *  a baseline timestamp from a live one at a glance. */
export const RERUN_START = RUN_START + 60_000
export const RERUN_END = RERUN_START + 2400

export const USERNAME = 'tomsmith'
export const VALID_PASSWORD = 'SuperSecretPassword!'
export const WRONG_PASSWORD = 'wrong-password'
export const SUBMIT_SELECTOR = 'button[type=submit]'
export const FLASH_SELECTOR = '#flash'

export const EXPECTED_FLASH = 'Secure Area'
export const BASELINE_FLASH = 'Your username is invalid!'
export const LATEST_FLASH = 'You logged into a secure area!'

/** The failed step's own error — one line, so it reads whole in a marker title
 *  and in the detail block's `assertion:` row. */
export const FLASH_ASSERTION_MESSAGE =
  'Expect $(`#flash`) to have text "Secure Area"'

// The SGR codes here carry no ESC byte on purpose: `cleanErrorMessage` matches
// `[<n>m` without one, so that is the form it actually strips (the errors panel
// uses a different cleaner, which needs the ESC — see ./fixtures.ts).
export const BASELINE_ERROR_MESSAGE = [
  'Expect $(`#flash`) to have text',
  '',
  '',
  '',
  `Expected: [32m"${EXPECTED_FLASH}"[39m`,
  `Received: [31m"${BASELINE_FLASH}"[39m`
].join('\n')

/** `BASELINE_ERROR_MESSAGE` as the banner renders it: colour codes gone, the
 *  run of blank lines collapsed to one. */
export const BASELINE_ERROR_LINES = [
  'Expect $(`#flash`) to have text',
  '',
  `Expected: "${EXPECTED_FLASH}"`,
  `Received: "${BASELINE_FLASH}"`
]

/** Passed, and holds the three form commands. */
export const FILL_STEP: PreservedStep = {
  uid: 'login-fill',
  title: 'fills the login form',
  fullTitle: 'login page fills the login form',
  start: RUN_START,
  end: RUN_START + 1400,
  state: 'passed'
}

/** Failed, and holds the submit + flash-read commands. The flash read is its
 *  last command, which is what makes it the step's failure site. */
export const ASSERT_STEP: PreservedStep = {
  uid: 'login-assert',
  title: 'shows the secure-area flash',
  fullTitle: 'login page shows the secure-area flash',
  start: RUN_START + 1500,
  end: RUN_START + 2600,
  state: 'failed',
  error: {
    message: FLASH_ASSERTION_MESSAGE,
    expected: EXPECTED_FLASH,
    actual: BASELINE_FLASH
  }
}

export interface RunShape {
  /** Wall clock of the run's first command. */
  start: number
  password: string
  /** What the flash read returned — `result` never takes part in pairing. */
  flash: string
}

/** The five commands both runs share the shape of. Same commands and args
 *  except the password, so index 2 is where the two runs fork. */
export function runCommands({
  start,
  password,
  flash
}: RunShape): CommandLog[] {
  return [
    commandLog({ command: 'url', args: [LOGIN_URL], timestamp: start }),
    commandLog({
      command: 'setValue',
      args: ['#username', USERNAME],
      timestamp: start + 500
    }),
    commandLog({
      command: 'setValue',
      args: ['#password', password],
      timestamp: start + 1000
    }),
    commandLog({
      command: 'click',
      args: [SUBMIT_SELECTOR],
      timestamp: start + 1600
    }),
    commandLog({
      command: 'getText',
      args: [FLASH_SELECTOR],
      result: flash,
      timestamp: start + 2100
    })
  ]
}

/** A sixth command, past the failed step's window — the baseline-only row, and
 *  the one command that resolves to no step at all. */
const baselineOnlyCommand = commandLog({
  command: 'getTitle',
  args: [],
  result: 'The Internet',
  timestamp: RUN_START + 2700
})

const baselineCommands: CommandLog[] = [
  ...runCommands({
    start: RUN_START,
    password: WRONG_PASSWORD,
    flash: BASELINE_FLASH
  }),
  baselineOnlyCommand
]

const scopedLiveCommands = runCommands({
  start: RERUN_START,
  password: VALID_PASSWORD,
  flash: LATEST_FLASH
})

/** Ran before the rerun's window, in the test the runner executed first. */
const beforeWindow = commandLog({
  command: 'deleteAllCookies',
  args: [],
  timestamp: RERUN_START - 5000
})

/** Ran after the rerun's window, in the test that followed it. */
const afterWindow = commandLog({
  command: 'url',
  args: [LOGIN_URL],
  timestamp: RERUN_START + 9000
})

export function preservedAttempt(
  overrides: Partial<PreservedAttempt> = {}
): PreservedAttempt {
  return {
    testUid: SELECTED_UID,
    scope: 'suite',
    capturedAt: RUN_START + 3000,
    window: { start: RUN_START, end: RUN_START + 2800 },
    test: {
      title: 'login page',
      fullTitle: 'login page',
      file: SPEC_FILE,
      state: 'failed',
      error: { message: BASELINE_ERROR_MESSAGE }
    },
    steps: [FILL_STEP, ASSERT_STEP],
    commands: baselineCommands,
    consoleLogs: [],
    networkRequests: [],
    mutations: [],
    sources: {},
    ...overrides
  }
}

/** The `baselineContext` value — baselines reach the app keyed by test uid. */
export function baselineMap(
  attempt: PreservedAttempt,
  uid: string = SELECTED_UID
): Map<string, PreservedAttempt> {
  return new Map([[uid, attempt]])
}

/** A live test entry. Defaults to `passed` — the rerun's outcome — where
 *  `testFragment` defaults to `failed` for the errors panel. */
export function liveTest(
  window: { start?: number; end?: number },
  overrides: Omit<Partial<TestStatsFragment>, 'uid'> & { uid?: string } = {}
): TestStatsFragment {
  const { uid = LIVE_TEST_UID, ...rest } = overrides
  return testFragment(uid, {
    title: uid,
    fullTitle: `login page ${uid}`,
    state: 'passed',
    start: window.start === undefined ? undefined : new Date(window.start),
    end: window.end === undefined ? undefined : new Date(window.end),
    ...rest
  })
}

/** The `suiteContext` value, with the selected uid as the suite the tests
 *  hang off. */
export function liveSuitesWith(
  ...tests: TestStatsFragment[]
): Record<string, SuiteStatsFragment>[] {
  return suiteRegistry(
    suiteFragment(SELECTED_UID, { title: 'login page', tests })
  )
}

const rerunTest = liveTest(
  { start: RERUN_START, end: RERUN_END },
  { title: 'logs in with valid credentials', fullTitle: LIVE_TEST_TITLE }
)

export interface LoginCompare {
  /** The whole live stream, including the commands of the tests either side of
   *  the rerun — the panel is expected to window those out. */
  liveCommands: CommandLog[]
  /** The five live commands inside the rerun's window. */
  scopedLiveCommands: CommandLog[]
  liveSuites: Record<string, SuiteStatsFragment>[]
  /** The rerun's live test entry, for specs that rebuild the registry. */
  rerunTest: TestStatsFragment
  /** Same suite, reached through two levels of parent suite. */
  nestedLiveSuites: Record<string, SuiteStatsFragment>[]
  /** The baseline's commands, in capture order. */
  baselineCommands: CommandLog[]
  /** Commands whose shape matches the rerun's exactly, on the baseline's clock —
   *  a preserved attempt that diverges nowhere. */
  identicalCommands: CommandLog[]
}

export const loginCompare: LoginCompare = {
  liveCommands: [beforeWindow, ...scopedLiveCommands, afterWindow],
  scopedLiveCommands,
  liveSuites: liveSuitesWith(rerunTest),
  rerunTest,
  nestedLiveSuites: suiteRegistry(
    suiteFragment('login-feature', {
      suites: [
        suiteFragment(SELECTED_UID, {
          suites: [suiteFragment('login-scenario', { tests: [rerunTest] })]
        })
      ]
    })
  ),
  baselineCommands,
  identicalCommands: runCommands({
    start: RUN_START,
    password: VALID_PASSWORD,
    flash: BASELINE_FLASH
  })
}
