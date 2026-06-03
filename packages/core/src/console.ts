import type { ConsoleLog, LogLevel, LogSource } from '@wdio/devtools-shared'

/**
 * Console methods we intercept to forward test/runner-process output into the
 * UI Console tab.
 */
export const CONSOLE_METHODS = ['log', 'info', 'warn', 'error'] as const

/**
 * Strips ANSI escape sequences (colour codes, cursor moves, etc.) from
 * terminal output so the UI Console renders plain text. The pattern accepts
 * any trailing letter, not just `m`, so cursor/style sequences are handled
 * too.
 */
export const ANSI_REGEX = /\x1b\[[?]?[0-9;]*[A-Za-z]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '')
}

/**
 * Log-level detection patterns, applied in priority order (highest to
 * lowest). The first matching pattern wins.
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

/** Visual indicators that suggest error-level logs in unstructured output. */
export const ERROR_INDICATORS = ['✗', 'failed', 'failure'] as const

/**
 * Matches the leading Braille spinner glyphs that runners (Nightwatch CLI,
 * Selenium tooling) emit for in-place progress updates. Adapters skip lines
 * that match this so the dashboard's Console tab isn't flooded with frames.
 */
export const SPINNER_RE = /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u

/**
 * Filter out terminal/stream lines that would feed back into the WS bridge
 * and cause an infinite forwarding loop: pino JSON output, [SESSION] markers,
 * backend logger lines, Jest console framing, and bare stack-frame lines.
 *
 * Adapters call this from their stream-patch before forwarding lines to the
 * UI Console tab. Combine with SPINNER_RE for full noise filtering.
 */
export function isInternalStreamLine(line: string): boolean {
  const t = line.trim()
  if (t.startsWith('{"') || t.startsWith('[SESSION]')) {
    return true
  }
  if (t.includes('@wdio/devtools-backend')) {
    return true
  }
  if (/^console\.(log|info|warn|error|debug|trace)$/.test(t)) {
    return true
  }
  if (/^at\s.+:\d+:\d+\)?$/.test(t)) {
    return true
  }
  return false
}

/** Enum-style accessor for the canonical LogSource values from shared. */
export const LOG_SOURCES = {
  BROWSER: 'browser',
  TEST: 'test',
  TERMINAL: 'terminal'
} as const satisfies Record<string, LogSource>

export type { LogSource } from '@wdio/devtools-shared'

/**
 * Classify a line of unstructured terminal output by scanning for log-level
 * keywords. Falls back to `'log'` when no pattern matches.
 */
export function detectLogLevel(text: string): LogLevel {
  const normalised = stripAnsi(text).toLowerCase()
  for (const { level, pattern } of LOG_LEVEL_PATTERNS) {
    if (pattern.test(normalised)) {
      return level
    }
  }
  if (ERROR_INDICATORS.some((i) => normalised.includes(i.toLowerCase()))) {
    return 'error'
  }
  return 'log'
}

/** Build a ConsoleLog entry tagged with the supplied source. */
export function createConsoleLogEntry(
  type: LogLevel,
  args: unknown[],
  source: LogSource = LOG_SOURCES.TEST
): ConsoleLog {
  return { timestamp: Date.now(), type, args, source }
}

/**
 * Map raw Chrome browser-log entries (the shape returned by both
 * `driver.manage().logs().get('browser')` in selenium-webdriver and
 * `browser.getLog('browser')` in nightwatch) into the dashboard's typed
 * ConsoleLog shape, tagged as source='browser'. Each entry's Chrome level
 * (`SEVERE` / `WARNING` / `INFO` / `DEBUG`) is normalised through
 * {@link chromeLogLevelToLogLevel}.
 */
export function mapChromeBrowserLogs(
  entries: Array<{ level: unknown; message: string; timestamp: number }>
): ConsoleLog[] {
  return entries.map((entry) => ({
    timestamp: entry.timestamp,
    type: chromeLogLevelToLogLevel(
      entry.level as string | { value?: number; name?: string }
    ),
    args: [entry.message],
    source: LOG_SOURCES.BROWSER
  }))
}

/**
 * Map a Chrome DevTools log-level string (or `{name, value}` object) to our
 * `LogLevel` union. Used by CDP/BiDi consumers that surface browser-side
 * console output through SEVERE/WARNING/INFO/DEBUG severity names.
 */
export function chromeLogLevelToLogLevel(
  level: string | { value?: number; name?: string }
): LogLevel {
  const levelName = (
    typeof level === 'object' ? (level?.name ?? '') : (level ?? '')
  ).toUpperCase()
  switch (levelName) {
    case 'SEVERE':
      return 'error'
    case 'WARNING':
      return 'warn'
    case 'INFO':
      return 'info'
    case 'DEBUG':
      return 'debug'
    default:
      return 'log'
  }
}
