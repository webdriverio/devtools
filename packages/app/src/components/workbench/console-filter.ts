/**
 * Pure helpers for the Console tab's search + level filtering, split out so the
 * matching logic can be unit-tested without rendering the component.
 */

import type { ConsoleLog, LogLevel } from '@wdio/devtools-shared'

/** Level filter options — `all` plus one per captured log type. */
export type ConsoleLevelFilter = 'all' | LogLevel

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

// Terminal escape sequences from the runner's logger and from framework error
// messages (node's AssertionError diff is colour-coded). Written with `\x1b`
// rather than a raw ESC byte: a literal control character here is invisible in
// an editor and in most diffs. Mirrors core's ANSI_REGEX — any trailing letter
// counts, so cursor sequences (`\x1b[2K`) go too, not just SGR colour (`m`).
// The app depends on shared only and cannot import core, so the pattern is
// duplicated deliberately; keep the two in step.
const ANSI_RE = /\x1b\[[?]?[0-9;]*[A-Za-z]/g

/** Remove terminal ANSI codes so logger output reads cleanly in the UI. */
export function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, '')
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
  logs: ConsoleLog[],
  level: ConsoleLevelFilter,
  search: string
): ConsoleLog[] {
  const needle = search.trim().toLowerCase()
  return logs.filter((log) => {
    // `ConsoleLog.type` is required, and the panel tags each row with it
    // unguarded — a default here would file an entry under a level its own row
    // does not claim.
    if (level !== 'all' && log.type !== level) {
      return false
    }
    if (needle && !formatConsoleArgs(log.args).toLowerCase().includes(needle)) {
      return false
    }
    return true
  })
}
