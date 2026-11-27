/** Characters a result holds when its caller names no budget; a rough stand-in for tokens. */
export const DEFAULT_MAX_CHARS = 20_000

/** The smallest budget a query accepts: below it a summary's own fields, or one error with its message, cannot fit, so the limit could not hold. */
export const MIN_QUERY_CHARS = 1_000

const MIB = 1024 * 1024

/** Largest zip opened, on disk or downloaded; a trace is usually a few megabytes. */
export const DEFAULT_MAX_ZIP_BYTES = 200 * MIB

/** Most the entries a trace's payload is built from may declare inflating to, below the reader's own ceiling. */
export const DEFAULT_MAX_INFLATED_BYTES = 256 * MIB

export const MAX_REDIRECTS = 5

/** Longest a download may go without receiving anything. */
export const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000

/** Longest a whole download may take, however steadily it trickles. */
export const DOWNLOAD_DEADLINE_MS = 300_000

/** Largest artifacts manifest read; a run of thousands of tests writes a few megabytes. */
export const MAX_MANIFEST_BYTES = 32 * 1024 * 1024

/** Folder entries visited while looking for zips without a manifest. */
export const MAX_FOLDER_ENTRIES = 10_000

/** Zips a folder without a manifest is searched to, and how many an error lists. */
export const MAX_FOLDER_DEPTH = 4
export const MAX_LISTED = 20

/** Characters of an action title in a list; a Python row's title can carry a whole element reference. */
export const MAX_TITLE_CHARS = 100

/** Characters of a message, URL or value in a list item, where many items share the budget. */
export const MAX_LIST_TEXT_CHARS = 300

/** Characters a row's or a summary's own text is cut to once there is nothing else left to shed. */
export const MIN_TEXT_CHARS = 60

/** Source lines shown on each side of an action's call site unless the caller names another count. */
export const DEFAULT_SOURCE_CONTEXT_LINES = 3

/** The most source lines a caller may ask for on each side of a call site. */
export const MAX_SOURCE_CONTEXT_LINES = 50

/** Characters of one source line, so a minified file cannot fill a result. */
export const MAX_SOURCE_LINE_CHARS = 200

/** How an action ended. */
export const ACTION_STATUS = {
  PASSED: 'passed',
  FAILED: 'failed',
  RETRIED: 'retried'
} as const

/** What a listed error is. */
export const TRACE_ERROR_KIND = {
  ACTION: 'action',
  STEP: 'step',
  CONSOLE: 'console',
  REQUEST: 'request'
} as const

/** Rows an action row or detail lists among those it issued, so one wait with many distinct calls stays within a page. */
export const MAX_LISTED_CHILDREN = 20

/** What each paged listing is, as its cursor's scope. */
export const PAGE_SCOPE = {
  ACTIONS: 'actions',
  ERRORS: 'errors',
  TRANSCRIPT: 'transcript'
} as const

/** Characters each field of an action's detail is cut to, tried in turn until the whole detail fits its budget. */
export const DETAIL_TEXT_STEPS = [2_000, 1_000, 500, 250, 120, 60] as const
