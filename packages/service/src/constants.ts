import type { ParserPlugin } from '@babel/parser'
import type { ScreencastOptions } from './types.js'

export const SCREENCAST_DEFAULTS: Required<ScreencastOptions> = {
  enabled: false,
  captureFormat: 'jpeg',
  quality: 70,
  maxWidth: 1280,
  maxHeight: 720,
  pollIntervalMs: 200
}

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

export const DEFAULT_LAUNCH_CAPS: WebdriverIO.Capabilities = {
  browserName: 'chrome',
  'goog:chromeOptions': {
    // production:
    args: ['--window-size=1600,1200']
    // development:
    // args: ['--window-size=1600,1200', '--auto-open-devtools-for-tabs']
  }
}

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
export const SPEC_FILE_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/i
export const FEATURE_FILE_RE = /\.feature$/i
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
