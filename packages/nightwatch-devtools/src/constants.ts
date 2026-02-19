export const PAGE_TRANSITION_COMMANDS = [
  'url',
  'navigateTo',
  'click',
  'submitForm'
] as const

/**
 * Internal Nightwatch commands to exclude from capture
 * These are helper/platform detection commands not relevant to users
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

/**
 * Console method types for log capturing
 */
export const CONSOLE_METHODS = ['log', 'info', 'warn', 'error'] as const

/**
 * Log level detection patterns
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
 * Console log source types
 */
export const LOG_SOURCES = {
  BROWSER: 'browser',
  TEST: 'test',
  TERMINAL: 'terminal'
} as const

/**
 * ANSI escape code regex - matches all ANSI escape sequences including:
 * - Color codes: \x1b[36m, \x1b[39m
 * - Cursor control: \x1b[2K, \x1b[1G, \x1b[1A
 * - Cursor visibility: \x1b[?25l, \x1b[?25h
 * - SGR parameters: \x1b[1m, \x1b[22m
 * Pattern: ESC [ (optional ?)(digits/semicolons)(letter)
 */
export const ANSI_REGEX = /\x1b\[[?]?[0-9;]*[A-Za-z]/g

/**
 * Default values
 */
export const DEFAULTS = {
  CID: '0-0',
  TEST_NAME: 'unknown',
  FILE_NAME: 'unknown',
  RETRIES: 0,
  DURATION: 0
} as const

/**
 * Timing constants (in milliseconds)
 */
export const TIMING = {
  UI_RENDER_DELAY: 150,
  TEST_START_DELAY: 100,
  SUITE_COMPLETE_DELAY: 200,
  UI_CONNECTION_WAIT: 10000,
  BROWSER_CLOSE_WAIT: 2000,
  INITIAL_CONNECTION_WAIT: 500,
  BROWSER_POLL_INTERVAL: 1000
} as const

/**
 * Test states
 */
export const TEST_STATE = {
  PENDING: 'pending',
  RUNNING: 'running',
  PASSED: 'passed',
  FAILED: 'failed',
  SKIPPED: 'skipped'
} as const

export type TestState = typeof TEST_STATE[keyof typeof TEST_STATE]

/**
 * Temporary UID generation pattern
 */
export const TEMP_UID_PREFIX = 'temp'
