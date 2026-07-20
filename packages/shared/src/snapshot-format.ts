// Single source of truth for the accessibility-snapshot text format (the
// `-snapshot.txt` trace resource). The producer (core's element-snapshot
// serializers) and the consumer (the app's A11y-tree parser) both reference
// these, so the written and parsed grammar can't drift. Keep one canonical form
// per concept — see CLAUDE.md § "One source of truth per concept".

/** Indent step per tree depth (the header sits at one unit; nodes at depth+1). */
export const SNAPSHOT_INDENT_UNIT = '  '

/** Prefix of the web page-header line (`[Page: <title> — <url>]`). */
export const SNAPSHOT_PAGE_HEADER = '[Page'

/** Separator between a node and its captured locator (rendered space-padded). */
export const SNAPSHOT_LOCATOR_DELIM = '→'

/** Marks an inferred purpose before the locator (`<role> ∈ "<purpose>"`). */
export const SNAPSHOT_PURPOSE_TOKEN = '∈'
