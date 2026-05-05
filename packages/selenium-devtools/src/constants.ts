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

export const CONSOLE_METHODS = ['log', 'info', 'warn', 'error'] as const

export const LOG_SOURCES = {
  BROWSER: 'browser',
  TEST: 'test',
  TERMINAL: 'terminal'
} as const

export const ANSI_REGEX = /\x1b\[[?]?[0-9;]*[A-Za-z]/g

export const SPINNER_RE = /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u

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

export const TEST_STATE = {
  PENDING: 'pending',
  RUNNING: 'running',
  PASSED: 'passed',
  FAILED: 'failed',
  SKIPPED: 'skipped'
} as const

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

export const SCREENCAST_DEFAULTS = {
  enabled: false,
  captureFormat: 'jpeg' as const,
  quality: 70,
  maxWidth: 1280,
  maxHeight: 720,
  pollIntervalMs: 200
}

/** Test-state environment markers used by the rerun handshake. */
export const REUSE_ENV = {
  REUSE: 'DEVTOOLS_APP_REUSE',
  HOST: 'DEVTOOLS_APP_HOST',
  PORT: 'DEVTOOLS_APP_PORT',
  RERUN_LABEL: 'DEVTOOLS_RERUN_LABEL',
  RERUN_ENTRY_TYPE: 'DEVTOOLS_RERUN_ENTRY_TYPE'
} as const

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
