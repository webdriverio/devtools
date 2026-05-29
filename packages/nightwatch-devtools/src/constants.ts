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
  'executeScript',
  // Internal Nightwatch transport commands (used for log capture, not user actions)
  'sessionLog',
  'sessionLogTypes',
  'isLogAvailable',
  'end'
] as const

// Console capture constants are defined in @wdio/devtools-core; re-exported
// here so existing imports from ./constants.js continue to work.
export {
  ANSI_REGEX,
  CONSOLE_METHODS,
  LOG_LEVEL_PATTERNS,
  LOG_SOURCES
} from '@wdio/devtools-core'

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

export { SPINNER_RE } from '@wdio/devtools-core'

/** Matches file names that follow the *.test.ts / *.spec.js naming convention. */
export const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/i

/** Nightwatch config file names to search for, in priority order. */
export const CONFIG_FILENAMES = [
  'nightwatch.conf.cjs',
  'nightwatch.conf.js',
  'nightwatch.conf.ts',
  'nightwatch.conf.mjs',
  'nightwatch.json'
] as const

/**
 * Global key used to share the plugin instance with Cucumber hooks.
 * Must match across index.ts and cucumberHooks.cts.
 */
export const PLUGIN_GLOBAL_KEY = '__nightwatchDevtoolsPlugin'
