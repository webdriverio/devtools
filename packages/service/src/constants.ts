import type { ParserPlugin } from '@babel/parser'

// SCREENCAST_DEFAULTS hoisted to @wdio/devtools-shared; re-exported for
// backwards compatibility with existing service-internal imports.
export { SCREENCAST_DEFAULTS } from '@wdio/devtools-shared'

export const PAGE_TRANSITION_COMMANDS: string[] = [
  'url',
  'navigateTo',
  'elementClick',
  'click'
]

// Console capture constants are defined in @wdio/devtools-core; re-exported
// here so existing imports from ./constants.js continue to work.
export {
  ANSI_REGEX,
  CONSOLE_METHODS,
  LOG_LEVEL_PATTERNS,
  ERROR_INDICATORS,
  LOG_SOURCES
} from '@wdio/devtools-core'

// The dashboard launches via the Puppeteer-based 'devtools' protocol, so the
// "controlled by automated test software" infobar (added by Puppeteer's
// --enable-automation default) is removed via ignoreDefaultArgs, not
// chromedriver's excludeSwitches. `wdio:devtoolsOptions` is honored at runtime
// but isn't in this WebdriverIO.Capabilities type, hence the assertion.
export const DEFAULT_LAUNCH_CAPS = {
  browserName: 'chrome',
  'goog:chromeOptions': {
    // production:
    args: ['--window-size=1600,1200']
    // development:
    // args: ['--window-size=1600,1200', '--auto-open-devtools-for-tabs']
  },
  'wdio:devtoolsOptions': {
    ignoreDefaultArgs: ['--enable-automation']
  }
} as WebdriverIO.Capabilities

export const INTERNAL_COMMANDS = [
  'emit',
  'browsingContextLocateNodes',
  'browsingContextNavigate',
  'waitUntil',
  'getTitle',
  'getUrl',
  'getWindowSize',
  'setWindowSize',
  'deleteSession',
  'findElementFromShadowRoot',
  'findElementsFromShadowRoot',
  'waitForExist',
  'browsingContextGetTree',
  'scriptCallFunction',
  'getElement',
  'execute',
  'findElement',
  'getElementText',
  'getElementShadowRoot',
  // Fired by the service itself; keep out of the user-facing Actions list.
  'scriptAddPreloadScript',
  'getPuppeteer',
  'takeScreenshot'
]

export const CONTEXT_CHANGE_COMMANDS = [
  'url',
  'back',
  'forward',
  'refresh',
  'switchFrame',
  'newWindow',
  'createWindow',
  'closeWindow'
]

/**
 * Parser options
 */
export const PARSE_PLUGINS = [
  'typescript',
  'jsx',
  'decorators-legacy',
  'classProperties',
  'dynamicImport'
] as const satisfies readonly ParserPlugin[]

/**
 * Test framework identifiers
 */
export const TEST_FN_NAMES = ['it', 'test', 'specify', 'fit', 'xit'] as const
export const SUITE_FN_NAMES = ['describe', 'context', 'suite'] as const
export const STEP_FN_NAMES = [
  'Given',
  'When',
  'Then',
  'And',
  'But',
  'defineStep'
] as const

/**
 * File/type recognizers
 */
export const STEP_FILE_RE = /\.(?:steps?)\.[cm]?[jt]sx?$/i
export const STEP_DIR_RE =
  /(?:^|\/)(?:step[-_]?definitions|steps)\/.+\.[cm]?[jt]sx?$/i
// SPEC_FILE_RE / FEATURE_FILE_RE come from shared — re-exported here so
// existing import sites in service keep resolving.
export { SPEC_FILE_RE, FEATURE_FILE_RE } from '@wdio/devtools-shared'
export const SOURCE_FILE_EXT_RE = /\.(?:[cm]?js|[cm]?ts)x?$/

/**
 * Gherkin Feature/Scenario line
 */
export const FEATURE_OR_SCENARIO_LINE_RE =
  /^\s*(Feature|Scenario(?: Outline)?):\s*(.+)\s*$/i

/**
 * Step definition textual scan regexes
 */
export const STEP_DEF_REGEX_LITERAL_RE =
  /\b(Given|When|Then|And|But)\s*\(\s*(\/(?:\\.|[^/\\])+\/[gimsuy]*)/
export const STEP_DEF_STRING_RE =
  /\b(Given|When|Then|And|But)\s*\(\s*(['`])([^'`\\]*(?:\\.[^'`\\]*)*)\2/

/**
 * Step directories discovery
 */
export const STEPS_DIR_CANDIDATES = [
  'step-definitions',
  'step_definitions',
  'steps'
] as const
export const STEPS_DIR_ASCENT_MAX = 6
export const STEPS_GLOBAL_SEARCH_MAX_DEPTH = 5
