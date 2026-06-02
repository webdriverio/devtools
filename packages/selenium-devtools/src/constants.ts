/**
 * Selenium WebDriver methods we don't want to surface as user commands.
 * These are either internal lifecycle (quit, close, getSession), capability
 * inspection (getCapabilities), or low-level helpers (sleep, schedule).
 */
export const INTERNAL_DRIVER_METHODS = [
  'constructor',
  'getSession',
  'getCapabilities',
  'getExecutor',
  'execute',
  'schedule',
  'manage',
  'navigate',
  'switchTo',
  'actions',
  'wait',
  'sleep',
  'setFileDetector',
  'getNetworkConnection',
  'setNetworkConnection',
  'on',
  'once',
  'addListener',
  'removeListener',
  'emit',
  'eventNames',
  /* Plumbing — selenium-webdriver itself calls these during BiDi/CDP setup. */
  'getBidi',
  'getCdpTargets',
  'createCDPConnection',
  'getWsUrl',
  /* These are wrapped separately — see patchSelenium quit/close interceptors. */
  'quit',
  'close'
] as const

/**
 * WebElement methods we DO surface (everything else is skipped).
 * Whitelist approach because WebElement's prototype carries fewer interesting
 * action methods than WebDriver's, and skipping is cheaper.
 */
export const TRACKED_ELEMENT_METHODS = [
  'click',
  'sendKeys',
  'clear',
  'submit',
  'getText',
  'getAttribute',
  'getCssValue',
  'getRect',
  'getTagName',
  'isDisplayed',
  'isEnabled',
  'isSelected'
] as const

export const NAVIGATION_COMMANDS = [
  'get',
  'navigate',
  'to',
  'back',
  'forward',
  'refresh'
] as const

// Console capture constants are defined in @wdio/devtools-core; re-exported
// here so existing imports from ./constants.js continue to work.
export { ANSI_REGEX, CONSOLE_METHODS, LOG_SOURCES } from '@wdio/devtools-core'

export { SPINNER_RE } from '@wdio/devtools-core'

export const DEFAULTS = {
  CID: '0-0',
  SESSION_TITLE: 'Selenium Session',
  FILE_NAME: 'selenium',
  RETRIES: 0,
  DURATION: 0
} as const

export const TIMING = {
  UI_RENDER_DELAY: 150,
  TEST_START_DELAY: 100,
  SUITE_COMPLETE_DELAY: 200,
  UI_CONNECTION_WAIT: 2000,
  BROWSER_CLOSE_WAIT: 2000,
  INITIAL_CONNECTION_WAIT: 500,
  BROWSER_POLL_INTERVAL: 1000
} as const

export { TEST_STATE } from '@wdio/devtools-shared'

export { LOG_LEVEL_PATTERNS } from '@wdio/devtools-core'

// SCREENCAST_DEFAULTS hoisted to @wdio/devtools-shared; re-exported for
// backwards compatibility with existing selenium-internal imports.
export { SCREENCAST_DEFAULTS } from '@wdio/devtools-shared'

/** Test-state environment markers used by the rerun handshake. */
export { REUSE_ENV } from '@wdio/devtools-shared'

/**
 * Decoded JPEG bytes below which a frame is treated as blank/uniform
 * (Chrome's about:blank — solid colour compresses to <2KB; real renders >5KB).
 */
export const BLANK_FRAME_THRESHOLD_BYTES = 4_000

/** Per-prototype "already patched" guard for driverPatcher / assertPatcher. */
export const PATCHED_SYMBOL = Symbol.for('@wdio/selenium-devtools/patched')

/** Per-prototype guard for the (currently disabled) node:assert patcher. */
export const ASSERT_PATCHED_SYMBOL = Symbol.for(
  '@wdio/selenium-devtools/assert-patched'
)

/** node:assert methods the (currently disabled) assertPatcher would wrap. */
export const TRACKED_ASSERT_METHODS = [
  'equal',
  'strictEqual',
  'deepEqual',
  'deepStrictEqual',
  'notEqual',
  'notStrictEqual',
  'notDeepEqual',
  'notDeepStrictEqual',
  'ok',
  'fail',
  'throws',
  'doesNotThrow',
  'rejects',
  'doesNotReject',
  'match',
  'doesNotMatch'
] as const
