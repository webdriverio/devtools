export const PAGE_TRANSITION_COMMANDS: string[] = [
  'url',
  'navigateTo',
  'elementClick',
  'click'
]

/**
 * Regular expression to strip ANSI escape codes from terminal output
 */
export const ANSI_REGEX = /\x1b\[[0-9;]*m/g

/**
 * Console method types for log capturing
 */
export const CONSOLE_METHODS = ['log', 'info', 'warn', 'error'] as const

/**
 * Log level detection patterns with priority order (highest to lowest)
 */
export const LOG_LEVEL_PATTERNS: ReadonlyArray<{
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error'
  pattern: RegExp
}> = [
  { level: 'trace', pattern: /\btrace\b/i },
  { level: 'debug', pattern: /\bdebug\b/i },
  { level: 'info', pattern: /\binfo\b/i },
  { level: 'warn', pattern: /\bwarn(ing)?\b/i },
  { level: 'error', pattern: /\berror\b/i }
] as const

/**
 * Visual indicators that suggest error-level logs
 */
export const ERROR_INDICATORS = ['✗', '✓', 'failed', 'failure'] as const

/**
 * Console log source types
 */
export const LOG_SOURCES = {
  BROWSER: 'browser',
  TEST: 'test',
  TERMINAL: 'terminal'
} as const

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
  'getElementShadowRoot'
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
 * Existing pattern (kept for any external consumers)
 */
export const SPEC_FILE_PATTERN =
  /\/(test|spec|features|pageobjects|@wdio\/expect-webdriverio)\//i

/**
 * Parser options
 */
export const PARSE_PLUGINS = [
  'typescript',
  'jsx',
  'decorators-legacy',
  'classProperties',
  'dynamicImport'
] as const

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
