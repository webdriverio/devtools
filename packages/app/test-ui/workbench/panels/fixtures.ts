// One login run, seen by every workbench panel: console entries, network
// requests, command failures, session metadata and captured spec sources. Each
// panel takes its data through @lit/context, so a spec hands these values to
// `mountWithContext` rather than setting properties.
//
// Typed against shared's `ConsoleLog`/`NetworkRequest` — the contracts the
// adapters produce. The panels annotate the same data with the browser-side
// globals of the same name, which resolve to `any` in this program
// (packages/script/types.d.ts aliases both to themselves), so shared is the
// only shape that actually type-checks a fixture.

import { TraceType } from '@wdio/devtools-shared'
import type {
  CommandLog,
  ConsoleLog,
  Metadata,
  NetworkRequest,
  SerializedError
} from '@wdio/devtools-shared'

import type {
  SuiteStatsFragment,
  TestStatsFragment
} from '../../../src/controller/types.js'
import { commandLog } from '../../support/builders.js'

/** Wall-clock origin of the fixture run — the offsets below read as ms into it. */
export const RUN_START = 1_700_000_000_000

/** The page the fixture run drives — the demo app every example project uses. */
export const LOGIN_URL = 'https://the-internet.herokuapp.com/login'

export function consoleLog(overrides: Partial<ConsoleLog> = {}): ConsoleLog {
  return {
    type: 'log',
    args: ['log line'],
    timestamp: RUN_START,
    ...overrides
  }
}

export function networkRequest(
  overrides: Partial<NetworkRequest> = {}
): NetworkRequest {
  return {
    id: 'req-1',
    url: LOGIN_URL,
    method: 'GET',
    type: 'document',
    status: 200,
    timestamp: RUN_START,
    startTime: RUN_START,
    ...overrides
  }
}

/** `runnerWarn`'s message once the panel has stripped its SGR codes. */
export const RUNNER_WARN_TEXT = '[WARN] retrying assertion on #flash'

/** Wider than the message column by two orders of magnitude — the panel wraps
 *  it (CSS `pre-wrap`/`break-word`) and never shortens the text. */
export const LONG_CONSOLE_MESSAGE = `Unhandled rejection: ${'at Object.<anonymous> (login.e2e.ts:42:7) '.repeat(
  40
)}`

export interface LoginConsole {
  /** Capture order, which is the order the panel renders. */
  logs: ConsoleLog[]
  /** Page-side `console.log`, and the run's first entry — elapsed origin. */
  pageLog: ConsoleLog
  /** Spec-side log, 0.4s in. */
  testInfo: ConsoleLog
  /** Runner stdout, 1.2s in, carrying the SGR residue a coloured logger leaves. */
  runnerWarn: ConsoleLog
  /** Page-side error, 2.5s in. */
  pageError: ConsoleLog
}

const pageLog = consoleLog({
  type: 'log',
  args: ['[TEST] logging in with valid credentials'],
  source: 'browser',
  timestamp: RUN_START
})

const testInfo = consoleLog({
  type: 'info',
  args: ['navigating to /secure'],
  source: 'test',
  timestamp: RUN_START + 400
})

// The `\u001b` prefixes are load-bearing: `stripAnsi` matches `ESC[<n>m`, so a
// colour code that reached the app without its ESC stays in the rendered row.
const runnerWarn = consoleLog({
  type: 'warn',
  args: ['\u001b[33m[WARN]\u001b[39m retrying assertion on #flash'],
  source: 'terminal',
  timestamp: RUN_START + 1200
})

const pageError = consoleLog({
  type: 'error',
  args: ["TypeError: Cannot read properties of undefined (reading 'flash')"],
  source: 'browser',
  timestamp: RUN_START + 2500
})

export const loginConsole: LoginConsole = {
  logs: [pageLog, testInfo, runnerWarn, pageError],
  pageLog,
  testInfo,
  runnerWarn,
  pageError
}

export interface LoginNetwork {
  /** Capture order, which is the order the panel renders. */
  requests: NetworkRequest[]
  /** Slowest at 800ms, so its bar fills the track; HTML by content-type. */
  pageHtml: NetworkRequest
  /** Half the slowest, so a half-width bar; JS by content-type. */
  script: NetworkRequest
  /** POST with headers and JSON bodies on both sides — drives the detail panel.
   *  At 8ms it is also the request that needs the bar's minimum width. */
  api: NetworkRequest
  /** 404 with no response headers: typed by URL extension, size unknown. */
  missingImage: NetworkRequest
  /** Transport failure — no status, an `error`, still timed. */
  failedFont: NetworkRequest
  /** 3xx, the one request in the redirect status bucket. */
  redirect: NetworkRequest
  /** In flight: no status, no timing, no size, no headers. */
  pending: NetworkRequest
}

const pageHtml = networkRequest({
  id: 'req-html',
  url: LOGIN_URL,
  type: 'document',
  status: 200,
  statusText: 'OK',
  requestHeaders: { accept: 'text/html' },
  responseHeaders: { 'content-type': 'text/html; charset=utf-8' },
  size: 12_288,
  time: 800,
  timestamp: RUN_START,
  startTime: RUN_START,
  endTime: RUN_START + 800
})

const script = networkRequest({
  id: 'req-js',
  url: 'https://the-internet.herokuapp.com/js/vendor/jquery-1.11.3.min.js',
  type: 'script',
  status: 200,
  statusText: 'OK',
  responseHeaders: { 'content-type': 'application/javascript' },
  size: 240_000,
  time: 400,
  timestamp: RUN_START + 820,
  startTime: RUN_START + 820,
  endTime: RUN_START + 1220
})

const api = networkRequest({
  id: 'req-api',
  url: 'https://the-internet.herokuapp.com/api/session',
  method: 'POST',
  type: 'fetch',
  status: 200,
  statusText: 'OK',
  requestHeaders: { 'content-type': 'application/json' },
  responseHeaders: { 'content-type': 'application/json' },
  requestBody: '{"sku":"AB-1","qty":2}',
  responseBody: '{"ok":true,"items":2}',
  size: 320,
  time: 8,
  timestamp: RUN_START + 1300,
  startTime: RUN_START + 1300,
  endTime: RUN_START + 1308
})

const missingImage = networkRequest({
  id: 'req-img',
  url: 'https://the-internet.herokuapp.com/img/missing-avatar.png',
  type: 'image',
  status: 404,
  statusText: 'Not Found',
  time: 120,
  timestamp: RUN_START + 1500,
  startTime: RUN_START + 1500,
  endTime: RUN_START + 1620
})

const failedFont = networkRequest({
  id: 'req-font',
  url: 'https://the-internet.herokuapp.com/fonts/inter.woff2',
  type: 'font',
  status: undefined,
  error: 'net::ERR_CONNECTION_REFUSED',
  time: 200,
  timestamp: RUN_START + 1700,
  startTime: RUN_START + 1700,
  endTime: RUN_START + 1900
})

const redirect = networkRequest({
  id: 'req-redirect',
  url: 'https://the-internet.herokuapp.com/authenticate',
  type: 'document',
  status: 302,
  statusText: 'Found',
  time: 40,
  timestamp: RUN_START + 1900,
  startTime: RUN_START + 1900,
  endTime: RUN_START + 1940
})

const pending = networkRequest({
  id: 'req-pending',
  url: 'https://the-internet.herokuapp.com/api/notifications?limit=4',
  type: 'fetch',
  status: undefined,
  timestamp: RUN_START + 2100,
  startTime: RUN_START + 2100
})

export const loginNetwork: LoginNetwork = {
  requests: [
    pageHtml,
    script,
    api,
    missingImage,
    failedFont,
    redirect,
    pending
  ],
  pageHtml,
  script,
  api,
  missingImage,
  failedFont,
  redirect,
  pending
}

// --- The spec under test ----------------------------------------------------
// One file, shared by the errors and source panels: the errors anchor points
// into it, the source panel renders it, and the line constants below are the
// 1-based indices the call sources name.

/** Three directories deep, so the Errors anchor's last-three-segments label is
 *  a real truncation and the Source toolbar's path is really elided. */
export const SPEC_FILE = '/repo/test/specs/login.e2e.ts'
export const STEPS_FILE = '/repo/test/step-definitions/login.steps.ts'
/** Named by a command's call source but never captured as a source. */
export const HELPER_FILE = '/repo/test/support/helpers.ts'

export const SPEC_LINES = [
  "import { $, browser, expect } from '@wdio/globals'",
  "import assert from 'node:assert'",
  '',
  "describe('login page', () => {",
  "  it('logs in with valid credentials', async () => {",
  "    await browser.url('https://the-internet.herokuapp.com/login')",
  "    await $('#username').setValue('tomsmith')",
  "    await $('#password').setValue('SuperSecretPassword!')",
  "    await $('button[type=submit]').click()",
  "    await expect($('#flash')).toHaveText('Secure Area')",
  "    assert.strictEqual(await browser.getTitle(), 'Secure Area')",
  '  })',
  '})'
]

export const NAVIGATE_LINE = 6
export const SET_VALUE_LINE = 7
export const CLICK_LINE = 9
export const MATCHER_LINE = 10
export const ASSERT_LINE = 11

export const STEPS_LINES = [
  "import { When } from '@cucumber/cucumber'",
  '',
  "When('I log in as {string}', async (user) => {",
  "  await $('#username').setValue(user)",
  '})'
]

export const STEPS_SET_VALUE_LINE = 4

export const NAVIGATE_CALL_SOURCE = `${SPEC_FILE}:${NAVIGATE_LINE}:19`
export const SET_VALUE_CALL_SOURCE = `${SPEC_FILE}:${SET_VALUE_LINE}:26`
export const CLICK_CALL_SOURCE = `${SPEC_FILE}:${CLICK_LINE}:36`
export const MATCHER_CALL_SOURCE = `${SPEC_FILE}:${MATCHER_LINE}:11`
export const ASSERT_CALL_SOURCE = `${SPEC_FILE}:${ASSERT_LINE}:12`
export const STEPS_CALL_SOURCE = `${STEPS_FILE}:${STEPS_SET_VALUE_LINE}:24`
export const HELPER_CALL_SOURCE = `${HELPER_FILE}:12:9`

// --- Errors panel -----------------------------------------------------------

/** Stack as a captured failure carries it: a user frame, then a node internal. */
export const STACK_FRAMES = [
  `    at Context.<anonymous> (${SPEC_FILE}:${MATCHER_LINE}:11)`,
  '    at processTicksAndRejections (node:internal/process/task_queues:95:5)'
]

/** A failing expect-webdriverio matcher's message: a headline, then
 *  jest-matcher-utils' Expected/Received block — whose values arrive already
 *  quoted (`printExpected`). ANSI is stripped before it reaches the app. */
export const MATCHER_HEADLINE = 'Expect $(`#flash`) to have text'
export const MATCHER_EXPECTED = '"Secure Area"'
export const MATCHER_RECEIVED = '"You logged into a secure area!"'
export const MATCHER_MESSAGE = [
  MATCHER_HEADLINE,
  '',
  `Expected: ${MATCHER_EXPECTED}`,
  `Received: ${MATCHER_RECEIVED}`
].join('\n')

/** A node:assert failure the way core's `describeAssertFailure` rewrites it —
 *  node's auto-generated per-character diff replaced by a value-bearing block,
 *  with the clean values also carried as a collapsed result. */
export const ASSERT_HEADLINE = 'strictEqual(actual, expected)'
export const ASSERT_EXPECTED = 'Secure Area'
export const ASSERT_ACTUAL = 'Login Page'
export const ASSERT_MESSAGE = [
  ASSERT_HEADLINE,
  '',
  `Expected: '${ASSERT_EXPECTED}'`,
  `Received: '${ASSERT_ACTUAL}'`
].join('\n')

export const CLICK_MESSAGE =
  'Can not call click on element with selector "#login" because element was not found'

export const HOOK_MESSAGE =
  'beforeEach hook: browser.setWindowRect is not a function'

/** A command failure as it crosses the WS bridge — the serialized shape, so a
 *  fixture can model an error with no stack at all. */
export function capturedError(
  message: string,
  overrides: Partial<SerializedError> = {}
): SerializedError {
  return { name: 'Error', message, ...overrides }
}

/** A test-level failure. `@wdio/reporter` types `TestStats.error` as a real
 *  `Error`, which always synthesizes a stack — assigned unconditionally here so
 *  a fixture can model a failure that reached the app without one. */
export function testError(message: string, stack?: string): Error {
  const error = new Error(message)
  error.stack = stack
  return error
}

/** Defaults to `failed`: the Errors panel reads no other test state. */
export function testFragment(
  uid: string,
  overrides: Omit<Partial<TestStatsFragment>, 'uid'> = {}
): TestStatsFragment {
  return {
    uid,
    title: uid,
    fullTitle: uid,
    file: SPEC_FILE,
    state: 'failed',
    ...overrides
  }
}

export function suiteFragment(
  uid: string,
  overrides: Omit<Partial<SuiteStatsFragment>, 'uid'> = {}
): SuiteStatsFragment {
  return {
    uid,
    title: uid,
    fullTitle: uid,
    file: SPEC_FILE,
    tests: [],
    suites: [],
    ...overrides
  }
}

/** The `suiteContext` value — the registry reaches the app as uid-keyed chunks. */
export function suiteRegistry(
  ...suites: SuiteStatsFragment[]
): Record<string, SuiteStatsFragment>[] {
  return [Object.fromEntries(suites.map((suite) => [suite.uid, suite]))]
}

export interface LoginErrors {
  /** Capture order, which is deliberately *not* timestamp order. */
  commands: CommandLog[]
  /** Succeeded, so it contributes no row. */
  navigate: CommandLog
  /** Earliest failure; carries no assertion values, so it renders message-first. */
  click: CommandLog
  /** expect-webdriverio matcher — its diff lives in the message. */
  matcher: CommandLog
  /** node:assert — its diff lives in a collapsed result, and it has no stack. */
  nativeAssert: CommandLog
  /** One passed and one failed test; only the hook failure adds a row. */
  suites: Record<string, SuiteStatsFragment>[]
}

const navigate = commandLog({
  command: 'url',
  args: [LOGIN_URL],
  callSource: NAVIGATE_CALL_SOURCE,
  timestamp: RUN_START
})

const clickFailure = commandLog({
  command: 'click',
  args: ['#login'],
  callSource: CLICK_CALL_SOURCE,
  timestamp: RUN_START + 1000,
  error: capturedError(CLICK_MESSAGE, {
    stack: `Error: ${CLICK_MESSAGE}\n${STACK_FRAMES.join('\n')}`
  })
})

const matcherFailure = commandLog({
  command: 'expect.toHaveText',
  args: [ASSERT_EXPECTED],
  callSource: MATCHER_CALL_SOURCE,
  timestamp: RUN_START + 3000,
  error: capturedError(MATCHER_MESSAGE, {
    stack: `Error: ${MATCHER_MESSAGE}\n${STACK_FRAMES.join('\n')}`
  })
})

const nativeAssertFailure = commandLog({
  command: 'assert.strictEqual',
  args: [ASSERT_ACTUAL, ASSERT_EXPECTED],
  result: { passed: false, actual: ASSERT_ACTUAL, expected: ASSERT_EXPECTED },
  callSource: ASSERT_CALL_SOURCE,
  timestamp: RUN_START + 4000,
  error: capturedError(ASSERT_MESSAGE, { name: 'AssertionError' })
})

export const loginErrors: LoginErrors = {
  commands: [navigate, matcherFailure, nativeAssertFailure, clickFailure],
  navigate,
  click: clickFailure,
  matcher: matcherFailure,
  nativeAssert: nativeAssertFailure,
  suites: suiteRegistry(
    suiteFragment('login-suite', {
      title: 'login page',
      tests: [
        testFragment('login-valid', {
          title: 'logs in with valid credentials',
          fullTitle: 'login page logs in with valid credentials',
          state: 'passed',
          error: testError('stale element reference on the first attempt')
        }),
        testFragment('login-logout', {
          title: 'logs out again',
          fullTitle: 'login page logs out again',
          callSource: `${SPEC_FILE}:14:3`,
          error: testError(
            HOOK_MESSAGE,
            `Error: ${HOOK_MESSAGE}\n${STACK_FRAMES.join('\n')}`
          )
        })
      ]
    })
  )
}

// --- Metadata panel ---------------------------------------------------------

export const SECURE_URL = 'https://the-internet.herokuapp.com/secure'

export function metadata(overrides: Partial<Metadata> = {}): Metadata {
  return { type: TraceType.Testrunner, ...overrides }
}

/** Every field the Session section knows, plus a boolean, an object and a
 *  string capability — one fixture covering each value renderer. */
export const loginMetadata = metadata({
  sessionId: '3a7f19c4e2b8',
  testEnv: 'local',
  host: 'http://localhost:4444',
  modulePath: SPEC_FILE,
  url: LOGIN_URL,
  viewport: { width: 1600, height: 900, offsetLeft: 0, offsetTop: 0, scale: 1 },
  capabilities: {
    browserName: 'chrome',
    browserVersion: '149.0.7204.15',
    'goog:chromeOptions': { args: ['--headless=new'] },
    setWindowRect: true
  },
  desiredCapabilities: { browserName: 'chrome', acceptInsecureCerts: false },
  options: { waitforTimeout: 5000, logLevel: 'error' }
})

/** A second session, on the page the login redirects to. */
export const secureMetadata = metadata({
  sessionId: 'b52d08fa17c6',
  url: SECURE_URL,
  capabilities: { browserName: 'firefox' }
})

// --- Source panel -----------------------------------------------------------

export const loginSources: Record<string, string> = {
  [SPEC_FILE]: SPEC_LINES.join('\n'),
  [STEPS_FILE]: STEPS_LINES.join('\n')
}

/** Commands whose call sources cover all three files: two lines of the captured
 *  spec, one of the captured step definitions, and one file never captured. */
export const loginSourceCommands: CommandLog[] = [
  commandLog({
    command: 'url',
    args: [LOGIN_URL],
    callSource: NAVIGATE_CALL_SOURCE,
    timestamp: RUN_START
  }),
  commandLog({
    command: 'setValue',
    args: ['#username', 'tomsmith'],
    callSource: SET_VALUE_CALL_SOURCE,
    timestamp: RUN_START + 500
  }),
  commandLog({
    command: 'setValue',
    args: ['#username', 'tomsmith'],
    callSource: STEPS_CALL_SOURCE,
    timestamp: RUN_START + 900
  }),
  commandLog({
    command: 'getTitle',
    args: [],
    callSource: HELPER_CALL_SOURCE,
    timestamp: RUN_START + 1200
  })
]
