/** Characters a result holds when its caller names no budget; a rough stand-in for tokens. */
export const DEFAULT_MAX_CHARS = 20_000

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
