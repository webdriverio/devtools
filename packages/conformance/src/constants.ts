import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { WS_SCOPE, type WsMessageScope } from '@wdio/devtools-shared'

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
 *  same pages in the same order. The Python scenario repeats the names. */
export const SCENARIO_ENV = {
  webdriver: 'CONFORMANCE_WEBDRIVER',
  login: 'CONFORMANCE_LOGIN_URL',
  broken: 'CONFORMANCE_BROKEN_URL'
} as const

export const SCENARIO_TIMEOUT_MS = 60_000

export const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf'

// Long enough that a row stamped at invocation predates the page it loaded.
export const NAVIGATION_HALF_MS = 15

export const BLANK_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

/** Selector → the page a click on it loads, or `null` for a field. */
export const PAGES: Record<string, Record<string, string | null>> = {
  '/login': {
    '#username': null,
    '#password': null,
    'button[type="submit"]': '/secure'
  },
  '/secure': { '#flash': null, '#logout': '/login' }
}

export const BROKEN_PATH = '/broken'

/** W3C's session defaults: a real browser always answers `GET /timeouts` with all three, and WebdriverIO 10.1 reads `script` from it before every BiDi `execute`. */
export const DEFAULT_TIMEOUTS = {
  script: 30_000,
  pageLoad: 300_000,
  implicit: 0
}

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
