import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { WS_SCOPE, type WsMessageScope } from '@wdio/devtools-shared'

import type { ScenarioTest } from './types.js'

export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
)

export const COLLECTOR_BUNDLE = path.join(
  REPO_ROOT,
  'packages/script/dist/script.js'
)

/**
 * How the fake browser serves BiDi, each the shape of a real driver: `live`
 * answers commands and emits network events (Chrome); `silent` answers
 * commands, accepts subscriptions and emits nothing (Appium 3.7's shim);
 * `off` offers no socket at all (Safari).
 */
export const BIDI_MODES = ['live', 'silent', 'off'] as const

export const RULES = {
  metadataFirst: 'metadata-before-commands',
  requestListed: 'every-browser-request-listed',
  requestListedOnce: 'one-row-per-browser-request',
  requestSourceServed: 'request-row-carries-what-the-browser-served',
  agreeOnRequests: 'adapters-agree-on-requests',
  completionStamp: 'row-stamped-at-completion',
  anchorBirthTime: 'anchor-carries-birth-time',
  documentAnchored: 'every-document-anchored',
  anchorOnce: 'one-anchor-per-document',
  rowReplaysPage: 'row-replays-its-page',
  navigationNamesDestination: 'navigation-row-names-its-destination',
  navigationTimings: 'navigation-row-carries-timings',
  pageAssertNamesNoElement: 'page-level-assertion-names-no-element',
  failureRecorded: 'failed-command-has-error-row',
  errorCarriesBrowserMessage: 'error-row-carries-browser-message',
  replaceTargetsRow: 'replace-targets-a-sent-row',
  rowPerAction: 'one-row-per-browser-action',
  runControlsServed: 'run-controls-are-served',
  testsAsDesigned: 'tests-end-as-designed',
  failedTestExplained: 'failed-test-has-error-row',
  callSiteInScenario: 'call-site-names-the-scenario',
  testHasRows: 'every-test-has-rows',
  waitParentsItsRows: 'wait-row-parents-its-commands',
  agreeOnActions: 'adapters-agree-on-actions',
  agreeOnErrors: 'adapters-agree-on-errors',
  agreeOnPages: 'adapters-agree-on-pages',
  agreeOnSnapshots: 'adapters-agree-on-snapshots',
  agreeOnRunControls: 'adapters-agree-on-run-controls'
} as const

const GUIDE = 'docs/ADAPTERS.md'

/** The responsibilities a rule can test, each a section of the adapter guide (paths from the repo root). */
export const RESPONSIBILITIES = {
  'command-interception': {
    title: 'Driver command interception',
    section: `${GUIDE}#2a-driver-command-interception`
  },
  collector: {
    title: 'Collector injection and draining',
    section: `${GUIDE}#2b-collector-injection-and-draining`
  },
  'framework-hooks': {
    title: 'Test-framework hooks',
    section: `${GUIDE}#2c-test-framework-hooks`
  },
  transport: {
    title: 'Transport, backend launch, and reruns',
    section: `${GUIDE}#2d-transport-backend-launch-and-reruns`
  },
  'wire-contract': {
    title: 'The wire contract',
    section: `${GUIDE}#frames-you-send`
  }
} as const

/** The collector's own source assigns its global; an adapter's probes and drains only read it. */
export const COLLECTOR_SIGNATURE = /wdioTraceCollector\s*=(?!=)/

/** The page's own Performance API read, recognised by the call that reads its navigation timings however a script phrases it. */
export const PERFORMANCE_SIGNATURE =
  /getEntriesByType(?:\?\.)?\(\s*['"]navigation['"]\s*\)/

/** User actions the fake browser counts, named as shared's ACTION_MAP names their method. */
export const ACTION_METHODS = ['navigate', 'click', 'fill'] as const

/** The scopes the rules read. */
export const SCOPES = {
  metadata: 'metadata',
  commands: 'commands',
  mutations: 'mutations',
  networkRequests: 'networkRequests',
  suites: 'suites',
  replaceCommand: WS_SCOPE.replaceCommand,
  config: WS_SCOPE.config
} as const satisfies Record<string, WsMessageScope>

export const DOCUMENT_MIME = 'text/html'

/** The subresources every page loads beside its document, with the content type the browser answers. */
export const SUBRESOURCES: Record<string, string> = {
  '/app.js': 'text/javascript',
  '/app.css': 'text/css'
}

/** Every scenario reads these and nothing else, so each language drives the
 *  same pages in the same order. Each spec repeats the names. */
export const SCENARIO_ENV = {
  webdriver: 'CONFORMANCE_WEBDRIVER',
  login: 'CONFORMANCE_LOGIN_URL',
  broken: 'CONFORMANCE_BROKEN_URL'
} as const

export const SCENARIO_TIMEOUT_MS = 60_000

/** The scenario's tests in order, as every spec titles them (pytest's `test_` names read the same), and how each must end. */
export const SCENARIO_TESTS: ScenarioTest[] = [
  { title: 'logs in and reads the greeting', state: 'passed' },
  { title: 'waits on what the page shows', state: 'passed' },
  { title: 'asserts on the page title', state: 'passed' },
  { title: 'fails on the wrong heading', state: 'failed' },
  { title: 'times out waiting for a missing element', state: 'failed' },
  { title: 'survives a refused navigation', state: 'passed' }
]

/** The scenario test whose assertions compare the page's title, a value no element produced. */
export const PAGE_TITLE_TEST = 'asserts on the page title'

/** What the scenario's condition wait reads, then what its helper wait reads again: as the specs write them. */
export const CONDITION_WAIT_READS = ['#flash', 'h2']
export const HELPER_WAIT_READ = '#flash'

/** The waits each scenario test writes, as normalized steps in order; a test not listed writes none. */
export const SCENARIO_WAITS: Record<string, string[]> = {
  'logs in and reads the greeting': ['Element.waitForExist #flash'],
  'waits on what the page shows': [
    'Browser.waitForFunction',
    'Browser.waitForFunction'
  ],
  'times out waiting for a missing element': ['Element.waitForExist #missing']
}

export const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf'

// Long enough that a row stamped at invocation predates the page it loaded.
export const NAVIGATION_HALF_MS = 15

export const BLANK_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

/** Selector → the page a click on it loads, or `null` for an element a click leaves in place. */
export const PAGES: Record<string, Record<string, string | null>> = {
  '/login': {
    h2: null,
    '#username': null,
    '#password': null,
    'button[type="submit"]': '/secure'
  },
  '/secure': { h2: null, '#flash': null, '#logout': '/login' }
}

/** Per page, the text an element reads back; an element not listed reads as empty. */
export const ELEMENT_TEXT: Record<string, Record<string, string>> = {
  '/login': { h2: 'Login Page' },
  '/secure': { h2: 'Secure Area', '#flash': 'You logged into a secure area!' }
}

/** Per page, its document title: each reads the same as the page's h2, so an assertion on the title can be mistaken for one on the heading. */
export const PAGE_TITLES: Record<string, string> = {
  '/login': 'Login Page',
  '/secure': 'Secure Area'
}

/** How long a load took, as the page's Resource Timing reports it. */
export const LOAD_MS = 5

export const RESPONSE_BYTES = 100

/** Elements a page renders this long after the document is born, so a wait for one polls before it succeeds. */
export const RENDERED_AFTER_MS: Record<string, number> = { '#flash': 150 }

export const BROKEN_PATH = '/broken'

export const BIDI_PATH = '/session/conformance/bidi'

/** BiDi acknowledgements whose callers read a field back; commands the fake browser models are answered from its state. */
export const BIDI_RESULTS: Record<string, unknown> = {
  'session.subscribe': { subscription: 'subscription-1' },
  'network.addIntercept': { intercept: 'intercept-1' }
}

/** The one top-level browsing context, as a window handle and as a BiDi context id. */
export const WINDOW_HANDLE = 'window-1'

/** Every scenario run dumps its stream here, and the HTML report is rebuilt from what is present. */
export const OUT_DIR = path.join(REPO_ROOT, 'packages/conformance/out')

export const REPORT_INDEX = 'index.html'

// Long enough to identify an argument, short enough to keep a timeline row on one line.
export const TARGET_MAX_CHARS = 120

const debt = (entry: string, issue?: string) =>
  `CLAUDE.md Known debt: "${entry}"${issue ? ` (${issue})` : ''}.`

const WAIT_ROW_DEBT = 'A wait is not yet one row parenting what it issued'

const SELENIUM_WAIT_DEBT =
  'A Selenium or Python wait has no row when it succeeds, and a condition row when it fails'

/** Why each scenario gap exists: the limitation, and the Known debt entry that describes it. */
export const KNOWN_DEBT = {
  conditionWait: `A passing condition wait shows as its reads in Selenium and Python, which have no row for the wait itself, and as one Browser.waitForFunction row in the WebdriverIO service, which hides the reads inside it. ${debt('A condition wait shows its reads in some adapters and one wait row in others', '#464')}`,
  seleniumWait: `A successful driver.wait() has no row of its own: its polls are findElements rows, which the trace vocabulary leaves unmapped. ${debt(SELENIUM_WAIT_DEBT, '#464')}`,
  seleniumFailedWait: `A timed-out driver.wait() is a wait row named after its condition, mapped to Browser.waitForFunction with no target, where the other adapters show Element.waitForExist on the selector. ${debt(SELENIUM_WAIT_DEBT, '#464')}`,
  pythonWait: `A successful WebDriverWait has no row of its own: its polls fold into findElement rows, which the trace vocabulary leaves unmapped. ${debt(SELENIUM_WAIT_DEBT, '#464')}`,
  pythonFailedWait: `A timed-out WebDriverWait is a wait row named after its condition, mapped to Browser.waitForFunction with no target, where the other adapters show Element.waitForExist on the selector. ${debt(SELENIUM_WAIT_DEBT, '#464')}`,
  serviceWaitRows: `The WebdriverIO service sends a wait row only once it completes and stamps it no id, and its waitUntil hides the reads its condition issues rather than nesting them. ${debt(WAIT_ROW_DEBT, '#464')}`,
  seleniumWaitRows: `A successful driver.wait() has no row, a timed-out one is named after its condition rather than its locator, and its polls name no parent. ${debt(WAIT_ROW_DEBT, '#464')}`,
  pythonWaitRows: `A successful WebDriverWait has no row, a timed-out one is named after its condition rather than its locator, and its polls name no parent. ${debt(WAIT_ROW_DEBT, '#464')}`
} as const
export const README_PAGE = 'README.md'

/** Where each capability table is rendered, relative to this repo or to a webdriverio checkout. */
export const CAPABILITY_TABLES = {
  'readme-trace': README_PAGE,
  'readme-dashboard': README_PAGE,
  'readme-mobile': README_PAGE,
  'cross-framework': 'website/docs/devtools/CrossFrameworkSupport.md',
  mobile: 'website/docs/devtools/MobileTesting.md'
} as const

export const SUPERSCRIPTS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹']

export const GENERATED_NOTICE =
  '<!-- Generated by `pnpm docs:capabilities` in webdriverio/devtools from packages/conformance/src/features.ts. Do not edit by hand. -->'

export const LEGEND =
  '✅ tested: proven for that adapter by the cross-adapter conformance suite. ✅: supported, backed by a named test or a manual check listed in [the feature list](https://github.com/webdriverio/devtools/blob/main/packages/conformance/src/features.ts).'
