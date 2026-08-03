// Single source of truth for the accessibility-snapshot text format (the
// `-snapshot.txt` trace resource). The producer (core's element-snapshot
// serializers) and the consumer (the app's A11y-tree parser) both reference
// these, so the written and parsed grammar can't drift. Keep one canonical form
// per concept — see CLAUDE.md § "One source of truth per concept".

/** Indent step per tree depth (the header sits at one unit; nodes at depth+1). */
export const SNAPSHOT_INDENT_UNIT = '  '

/** Prefix of the web page-header line (`[Page: <title> — <url>]`). */
export const SNAPSHOT_PAGE_HEADER = '[Page'

/** Native-mobile platforms the mobile serializer writes a header for. */
export const SNAPSHOT_NATIVE_PLATFORMS = ['android', 'ios'] as const

export type SnapshotNativePlatform = (typeof SNAPSHOT_NATIVE_PLATFORMS)[number]

/** Prefix of the native-mobile header line — bare `[android]` when the capture
 *  knew neither device nor viewport (what the per-action capture passes), else
 *  `[android — <device> (<width>×<height>)]`. */
export function snapshotNativeHeader(platform: SnapshotNativePlatform): string {
  return `[${platform}`
}

/** Whether a line is a snapshot's header rather than a tree node. Every
 *  serializer opens with exactly one — `[Page …]` for web, `[<platform> …]` for
 *  native — so both forms live in this one predicate and a consumer that only
 *  knew the web form cannot render a native header as a node. */
export function isSnapshotHeaderLine(line: string): boolean {
  return (
    line.startsWith(SNAPSHOT_PAGE_HEADER) ||
    SNAPSHOT_NATIVE_PLATFORMS.some((platform) =>
      line.startsWith(snapshotNativeHeader(platform))
    )
  )
}

/** Separator between a node and its captured locator (rendered space-padded). */
export const SNAPSHOT_LOCATOR_DELIM = '→'

/** Marks an inferred purpose before the locator (`<role> ∈ "<purpose>"`). */
export const SNAPSHOT_PURPOSE_TOKEN = '∈'
