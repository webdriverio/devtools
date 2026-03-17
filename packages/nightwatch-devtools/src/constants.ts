/**
 * Internal Nightwatch commands to exclude from capture
 */
export const INTERNAL_COMMANDS_TO_IGNORE = [
  'isAppiumClient',
  'isSafari',
  'isChrome',
  'isFirefox',
  'isEdge',
  'isMobile',
  'isAndroid',
  'isIOS',
  'session',
  'sessions',
  'timeouts',
  'timeoutsAsyncScript',
  'timeoutsImplicitWait',
  'getLog',
  'getLogTypes',
  'screenshot',
  'availableContexts',
  'currentContext',
  'setChromeOptions',
  'setDeviceName',
  'perform',
  'execute',
  'executeAsync',
  'executeScript'
] as const

export const CONSOLE_METHODS = ['log', 'info', 'warn', 'error'] as const

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

export const LOG_SOURCES = {
  BROWSER: 'browser',
  TEST: 'test',
  TERMINAL: 'terminal'
} as const

export const ANSI_REGEX = /\x1b\[[?]?[0-9;]*[A-Za-z]/g

export const DEFAULTS = {
  CID: '0-0',
  TEST_NAME: 'unknown',
  FILE_NAME: 'unknown',
  RETRIES: 0,
  DURATION: 0
} as const

/** Timing constants (in milliseconds) */
export const TIMING = {
  UI_RENDER_DELAY: 150,
  TEST_START_DELAY: 100,
  SUITE_COMPLETE_DELAY: 200,
  UI_CONNECTION_WAIT: 10000,
  BROWSER_CLOSE_WAIT: 2000,
  INITIAL_CONNECTION_WAIT: 500,
  BROWSER_POLL_INTERVAL: 1000
} as const

export const TEST_STATE = {
  PENDING: 'pending',
  RUNNING: 'running',
  PASSED: 'passed',
  FAILED: 'failed',
  SKIPPED: 'skipped'
} as const

/**
 * Generic pattern matching Nightwatch commands whose result is a boolean.
 */
export const BOOLEAN_COMMAND_PATTERN =
  /^waitFor|^is[A-Z]|^has[A-Z]|(Visible|Present|Enabled|Selected|NotVisible|NotPresent)$/

export const NAVIGATION_COMMANDS = ['url', 'navigate', 'navigateTo'] as const

/** Spinner progress frames — suppress from UI Console output. */
export const SPINNER_RE = /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u

/** Matches a path segment that indicates a test/spec directory (e.g. /tests/ or /spec/). */
export const TEST_PATH_PATTERN = /\/(test|spec|tests)\//i

/** Matches file names that follow the *.test.ts / *.spec.js naming convention. */
export const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/i
