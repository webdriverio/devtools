// Helpers over the trace action vocabulary. ACTION_MAP itself lives in
// @wdio/devtools-shared so the reader (backend) can derive its inverse from the
// same source. Ported from Vince Graics' PR #209 (`@wdio/tracing-service`); the
// existing devtools UI uses its own denylist (`INTERNAL_COMMANDS`) — this map
// is for the trace.zip exporter to filter + rename in one step.

import {
  ACTION_MAP,
  ASSERT_ACTION_CLASS,
  mapAssertCommand,
  type TraceAction
} from '@wdio/devtools-shared'

export type { TraceAction }
export { ASSERT_ACTION_CLASS, mapAssertCommand }

// Excluded by design:
//   clearValue / addValue — WDIO fires these inside setValue (duplicate events).
//   executeScript — Selenium's `until` polling fires it ~50ms; also recurses
//     because @wdio/elements uses executeScript inside captureActionSnapshot.
//     WDIO's user-facing `execute`/`executeAsync` are still captured.
//   $ / $$ / findElement(s) / getElement(s) — locator resolution fires on every
//     element access; high-frequency internal machinery, not a timeline step.
//   Passing expect-webdriverio matchers — never reach the command log (only
//     failures do, via the reporter); surfacing them is a per-adapter change.

export function mapCommandToAction(command: string): TraceAction | null {
  return ACTION_MAP[command] ?? mapAssertCommand(command)
}

const ASSERT_TITLE_VALUE_MAX = 40

function formatAssertValue(value: unknown): string {
  let text: string
  if (typeof value === 'object' && value !== null) {
    try {
      text = JSON.stringify(value)
    } catch {
      text = String(value)
    }
  } else {
    text = typeof value === 'string' ? JSON.stringify(value) : String(value)
  }
  return text.length > ASSERT_TITLE_VALUE_MAX
    ? `${text.slice(0, ASSERT_TITLE_VALUE_MAX - 1)}…`
    : text
}

// Prefer normalized actual/expected params (nightwatch collapses them into
// the result); fall back to the first two positional args (node:assert order).
function formatAssertTitle(
  action: TraceAction,
  args: unknown[],
  params?: Record<string, unknown>,
  command?: string
): string {
  const values =
    params && ('actual' in params || 'expected' in params)
      ? [params.actual, params.expected]
      : args.slice(0, 2)
  const label = values
    .filter((value) => value !== undefined)
    .map(formatAssertValue)
    .join(', ')
  return `${command ?? `assert.${action.method}`}(${label})`
}

export function formatActionTitle(
  action: TraceAction,
  args: unknown[],
  params?: Record<string, unknown>,
  command?: string
): string {
  if (action.class === ASSERT_ACTION_CLASS) {
    return formatAssertTitle(action, args, params, command)
  }
  const firstArg = args[0] ?? params?.selector
  if (firstArg === undefined) {
    return `${action.class}.${action.method}()`
  }
  const label =
    typeof firstArg === 'object' ? JSON.stringify(firstArg) : String(firstArg)
  return `${action.class}.${action.method}("${label}")`
}

/**
 * Methods where the first positional argument should render as value= in the
 * transcript line (e.g. setValue, selectByVisibleText).
 */
export const FILL_METHODS = new Set(['fill', 'selectOption'])
