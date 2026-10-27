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
  failureRecorded: 'failed-command-has-error-row',
  errorCarriesBrowserMessage: 'error-row-carries-browser-message',
  replaceTargetsRow: 'replace-targets-a-sent-row',
  rowPerAction: 'one-row-per-browser-action',
  runControlsServed: 'run-controls-are-served',
  testsAsDesigned: 'tests-end-as-designed',
  failedTestExplained: 'failed-test-has-error-row',
  callSiteInScenario: 'call-site-names-the-scenario',
  testHasRows: 'every-test-has-rows',
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
  { title: 'fails on the wrong heading', state: 'failed' },
  { title: 'times out waiting for a missing element', state: 'failed' },
  { title: 'survives a refused navigation', state: 'passed' }
]

/** What the scenario's condition wait reads, then what its helper wait reads again: as the specs write them. */
export const CONDITION_WAIT_READS = ['#flash', 'h2']
export const HELPER_WAIT_READ = '#flash'

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

/** Why each scenario gap exists: the limitation, and the Known debt entry that describes it. */
export const KNOWN_DEBT = {
  nightwatchSameMsReplace: `A Nightwatch row's late replaceCommand, keyed by timestamp, overwrites a later row stamped in the same millisecond, so an assertion row becomes a second copy of the read before it. ${debt('A same-millisecond replaceCommand overwrites the Nightwatch row after it', '#458')}`,
  nightwatchSkipped: `Nightwatch reports a passing test that ran no assertion as skipped, although it ran. ${debt('Nightwatch reports a passing test skipped', '#459')}`,
  conditionWait: `A passing condition wait shows as its reads in Selenium and Python, which have no row for the wait itself, as one Browser.waitForFunction row in the WebdriverIO service, which hides the reads inside it, and as both in Nightwatch. ${debt('A condition wait shows its reads in some adapters and one wait row in others', '#464')}`,
  seleniumWait: `A successful driver.wait() has no row of its own: its polls are findElements rows, which the trace vocabulary leaves unmapped. ${debt('A Selenium wait has no row when it succeeds, and a condition row when it fails', '#464')}`,
  seleniumFailedWait: `A timed-out driver.wait() is a wait row named after its condition, mapped to Browser.waitForFunction with no target, where the other adapters show Element.waitForExist on the selector. ${debt('A Selenium wait has no row when it succeeds, and a condition row when it fails', '#464')}`,
  pythonWait: `WebDriverWait is a client-side loop the adapter cannot see, so a wait has no row, and one that times out leaves its failed test without an error row. ${debt('A Python WebDriverWait leaves no row', '#461')}`
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
