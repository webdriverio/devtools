import { ACTION_MAP } from '@wdio/devtools-shared'

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
