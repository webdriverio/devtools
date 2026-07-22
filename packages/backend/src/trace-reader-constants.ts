import {
  ACTION_MAP,
  ASSERT_ACTION_CLASS,
  LOG_LEVELS,
  TRACKED_ASSERT_METHODS
} from '@wdio/devtools-shared'

/** Runtime lookup for narrowing foreign trace levels to the shared union. */
export const LOG_LEVEL_SET: ReadonlySet<string> = new Set(LOG_LEVELS)

/** Every zip entry ending in this suffix is an NDJSON action-event stream. */
export const TRACE_STREAM_SUFFIX = '.trace'

/** Every zip entry ending in this suffix is an NDJSON HAR-snapshot stream. */
export const NETWORK_STREAM_SUFFIX = '.network'

/** Sidecar entries holding call stacks keyed by numeric call id. */
export const STACKS_STREAM_SUFFIX = '.stacks'

/** Every zip entry ending in this suffix is an NDJSON DOM-mutation stream. */
export const MUTATIONS_STREAM_SUFFIX = '.mutations'

/** Foreign screencast refs may be a bare sha1; probe image extensions too. */
export const FRAME_RESOURCE_SUFFIXES = ['', '.jpeg', '.png'] as const

// Inverse of ACTION_MAP, derived so it can never drift from the forward map.
// The forward map is many-to-one (url/navigateTo/get all → Page.navigate); the
// first runner command listed for each trace action wins, matching the command
// name live mode shows so the UI colours/labels the row identically.
// Assert entries come from the same TRACKED_ASSERT_METHODS list the core
// patcher wraps, so `Assert.<m>` rows read back as `assert.<m>` commands.
export const REVERSE_ACTION_MAP: Record<string, string> = {
  ...Object.entries(ACTION_MAP).reduce<Record<string, string>>(
    (acc, [command, action]) => {
      const key = `${action.class}.${action.method}`
      if (!(key in acc)) {
        acc[key] = command
      }
      return acc
    },
    {}
  ),
  ...Object.fromEntries(
    TRACKED_ASSERT_METHODS.map((method) => [
      `${ASSERT_ACTION_CLASS}.${method}`,
      `assert.${method}`
    ])
  )
}
