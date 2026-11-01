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

/**
 * Roles that can be interacted with — rendered with `→ selector`.
 * Structural roles (heading, img, form, nav, …) are intentionally excluded.
 */
export const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'slider',
  'searchbox',
  'spinbutton',
  'switch',
  'tab',
  'menuitem',
  'option'
])

/** The fields of a node this module's helpers read. Deliberately narrower than
 *  `AccessibilityNode` so core's mobile `SnapshotNode` satisfies it too — both
 *  snapshot pipelines share these helpers. */
export interface SnapshotFormatNode {
  role: string
  name: string
  depth: number
}

/**
 * Returns true when `nodes[index]` is a statictext whose accessible name
 * is already echoed by its immediate interactive parent — such a node
 * adds no information and should be suppressed from the output.
 */
export function isStatictextEchoedByParent(
  nodes: SnapshotFormatNode[],
  index: number
): boolean {
  const node = nodes[index]!
  if (node.role !== 'statictext' || !node.name) {
    return false
  }
  for (let j = index - 1; j >= 0; j--) {
    if (nodes[j]!.depth < node.depth) {
      const parent = nodes[j]!
      if (
        INTERACTIVE_ROLES.has(parent.role) &&
        parent.name &&
        parent.name.includes(node.name)
      ) {
        return true
      }
      break
    }
  }
  return false
}
