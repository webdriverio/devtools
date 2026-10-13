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

export const RULES = {
  metadataFirst: 'metadata-before-commands',
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
  replaceCommand: WS_SCOPE.replaceCommand
} as const satisfies Record<string, WsMessageScope>

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

export const BIDI_PATH = '/session/conformance/bidi'

/** BiDi results whose callers read a field back; every other command gets `{}`. */
export const BIDI_RESULTS: Record<string, unknown> = {
  'script.addPreloadScript': { script: 'preload-1' },
  'session.subscribe': { subscription: 'subscription-1' },
  'network.addIntercept': { intercept: 'intercept-1' },
  'browsingContext.getTree': {
    contexts: [
      { context: 'context-1', url: 'about:blank', children: [], parent: null }
    ]
  }
}

/** Every scenario run dumps its stream here, and the HTML report is rebuilt from what is present. */
export const OUT_DIR = path.join(REPO_ROOT, 'packages/conformance/out')

export const REPORT_INDEX = 'index.html'

// Long enough to identify an argument, short enough to keep a timeline row on one line.
export const TARGET_MAX_CHARS = 120
