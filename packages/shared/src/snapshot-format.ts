// Single source of truth for the accessibility-snapshot text format (the
// `-snapshot.txt` trace resource). The producers (trace's web and mobile
// serializers) and the consumer (`parseSnapshotLine` below, read by the app's
// A11y tab and by trace-query) both reference these, so the written and parsed
// grammar can't drift. Keep one canonical form
// per concept — see CLAUDE.md § Layering.

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

/** What separates a node from its locator, exactly as the serializers write it. */
export const SNAPSHOT_LOCATOR_SEPARATOR = `  ${SNAPSHOT_LOCATOR_DELIM}  `

/** What opens a node's quoted purpose, exactly as the serializers write it; a quote closes it. */
export const SNAPSHOT_PURPOSE_OPEN = ` ${SNAPSHOT_PURPOSE_TOKEN} "`

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

/** The fields `isStatictextEchoedByParent` reads; its callers (core's web adapter, trace's serializer) pass `AccessibilityNode`s. */
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

/** One node line of a snapshot, as the serializers write it. */
export interface SnapshotLine {
  /** Tree depth, 0 for a line at one indent unit past the header. */
  depth: number
  role: string
  name: string
  /** The inferred purpose after `∈`, when the line carries one. */
  purpose?: string
  /** What the line says before its locator: role, quoted name and purpose. */
  label: string
  /** The captured locator after `→`, when the node is an element. */
  selector?: string
}

const NAME_OPEN = ' "'

/** The quoted value opening at `from`, if one does: it closes at the first quote that a later segment or the line's end follows, so an arrow or a quote inside it stays part of it. A scan, not a regex, because a trace is untrusted and a backtracking pattern over a hostile line is quadratic. */
function quotedAt(
  text: string,
  from: number,
  open: string,
  closers: readonly string[]
): { value: string; end: number } | undefined {
  if (!text.startsWith(open, from)) {
    return undefined
  }
  const start = from + open.length
  for (let at = text.indexOf('"', start); at !== -1;) {
    const after = at + 1
    if (
      after === text.length ||
      closers.some((closer) => text.startsWith(closer, after))
    ) {
      return { value: text.slice(start, at), end: after }
    }
    at = text.indexOf('"', after)
  }
  return undefined
}

/** Reads one line of a snapshot back into its node; null for the header or a blank line. */
export function parseSnapshotLine(line: string): SnapshotLine | null {
  const text = line.trim()
  if (!text || isSnapshotHeaderLine(text)) {
    return null
  }
  const indent = line.length - line.trimStart().length
  const depth = Math.max(
    0,
    Math.floor(indent / SNAPSHOT_INDENT_UNIT.length) - 1
  )
  const space = text.indexOf(' ')
  const role = space === -1 ? text : text.slice(0, space)
  const name = quotedAt(text, role.length, NAME_OPEN, [
    SNAPSHOT_PURPOSE_OPEN,
    SNAPSHOT_LOCATOR_SEPARATOR
  ])
  const nameEnd = name?.end ?? role.length
  const purpose = quotedAt(text, nameEnd, SNAPSHOT_PURPOSE_OPEN, [
    SNAPSHOT_LOCATOR_SEPARATOR
  ])
  const labelEnd = text.indexOf(
    SNAPSHOT_LOCATOR_SEPARATOR,
    purpose?.end ?? nameEnd
  )
  const selector =
    labelEnd === -1
      ? undefined
      : text.slice(labelEnd + SNAPSHOT_LOCATOR_SEPARATOR.length).trim() ||
        undefined
  return {
    depth,
    role,
    name: name?.value ?? '',
    ...(purpose ? { purpose: purpose.value } : {}),
    label: labelEnd === -1 ? text : text.slice(0, labelEnd),
    ...(selector ? { selector } : {})
  }
}
