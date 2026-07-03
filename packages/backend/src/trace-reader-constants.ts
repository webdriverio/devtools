import { ACTION_MAP, LOG_LEVELS } from '@wdio/devtools-shared'

/** Runtime lookup for narrowing foreign trace levels to the shared union. */
export const LOG_LEVEL_SET: ReadonlySet<string> = new Set(LOG_LEVELS)

// Inverse of ACTION_MAP, derived so it can never drift from the forward map.
// The forward map is many-to-one (url/navigateTo/get all → Page.navigate); the
// first runner command listed for each trace action wins, matching the command
// name live mode shows so the UI colours/labels the row identically.
export const REVERSE_ACTION_MAP: Record<string, string> = Object.entries(
  ACTION_MAP
).reduce<Record<string, string>>((acc, [command, action]) => {
  const key = `${action.class}.${action.method}`
  if (!(key in acc)) {
    acc[key] = command
  }
  return acc
}, {})
