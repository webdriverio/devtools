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

import { DEFAULTS_BASE, TIMING_BASE } from '@wdio/devtools-shared'

export const DEFAULTS = {
  ...DEFAULTS_BASE,
  TEST_NAME: 'unknown',
  FILE_NAME: 'unknown'
} as const

export const TIMING = {
  ...TIMING_BASE,
  /** Nightwatch boots slower than selenium — give the dashboard 10s. */
  UI_CONNECTION_WAIT: 10000
} as const

export { TEST_STATE } from '@wdio/devtools-shared'

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
