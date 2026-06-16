/**
 * Pure helpers for the Console tab's search + level filtering, split out so the
 * matching logic can be unit-tested without rendering the component.
 */

/** Level filter options — `all` plus one per captured log type. */
export type ConsoleLevelFilter = 'all' | 'error' | 'warn' | 'info' | 'log'

/** Ordered level filters for the Console toolbar: filter key + display label. */
export const CONSOLE_LEVEL_FILTERS: ReadonlyArray<{
  key: ConsoleLevelFilter
  label: string
}> = [
  { key: 'all', label: 'All' },
  { key: 'error', label: 'Errors' },
  { key: 'warn', label: 'Warnings' },
  { key: 'info', label: 'Info' },
  { key: 'log', label: 'Logs' }
]

// SGR escape sequences (e.g. `[31m`) from the WDIO terminal logger render
// as stray `[31m` once the invisible ESC is dropped — strip them for display.
const ANSI_SGR_RE = /\[[0-9;]*m/g

/** Remove terminal ANSI color codes so logger output reads cleanly in the UI. */
export function stripAnsi(value: string): string {
  return value.replace(ANSI_SGR_RE, '')
}

/** Render a log entry's args into one string for display and search. */
export function formatConsoleArgs(args: unknown): string {
  if (!Array.isArray(args)) {
    return stripAnsi(String(args))
  }
  return stripAnsi(
    args
      .map((arg) => {
        if (typeof arg === 'string') {
          return arg
        }
        try {
          return JSON.stringify(arg, null, 2)
        } catch {
          return String(arg)
        }
      })
      .join(' ')
  )
}

/** Filter logs by level and a case-insensitive substring of the message. */
export function filterConsoleLogs(
  logs: ConsoleLogs[],
  level: ConsoleLevelFilter,
  search: string
): ConsoleLogs[] {
  const needle = search.trim().toLowerCase()
  return logs.filter((log) => {
    if (level !== 'all' && (log.type || 'log') !== level) {
      return false
    }
    if (needle && !formatConsoleArgs(log.args).toLowerCase().includes(needle)) {
      return false
    }
    return true
  })
}
