// Helpers over the trace action vocabulary. ACTION_MAP itself lives in
// @wdio/devtools-shared so the reader (backend) can derive its inverse from the
// same source. Ported from Vince Graics' PR #209 (`@wdio/tracing-service`); the
// existing devtools UI uses its own denylist (`INTERNAL_COMMANDS`) — this map
// is for the trace.zip exporter to filter + rename in one step.

import { ACTION_MAP, type TraceAction } from '@wdio/devtools-shared'

export type { TraceAction }

// Excluded by design:
//   clearValue / addValue — WDIO fires these inside setValue (duplicate events).
//   executeScript — Selenium's `until` polling fires it ~50ms; also recurses
//     because @wdio/elements uses executeScript inside captureActionSnapshot.
//     WDIO's user-facing `execute`/`executeAsync` are still captured.

export function mapCommandToAction(command: string): TraceAction | null {
  return ACTION_MAP[command] ?? null
}

export function formatActionTitle(
  action: TraceAction,
  args: unknown[],
  params?: Record<string, unknown>
): string {
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
