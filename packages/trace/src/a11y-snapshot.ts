/**
 * Accessibility tree → the indented text the trace's A11y tab parses.
 *
 * A pure transform over nodes a page-side script produced: no driver, no
 * framework, no DOM. It lives here rather than in `core` because the backend
 * builds the trace for an adapter that cannot run the transforms itself, and
 * §2.2 bars the backend from importing core — the same reason the rest of this
 * package moved. The JS adapters reach it through core's re-export unchanged.
 *
 * Only the WEB serializer is here. The mobile one shares helpers with the
 * locator generation that stays in `core`, and no adapter exporting through the
 * backend drives native mobile.
 */

import {
  INTERACTIVE_ROLES,
  isStatictextEchoedByParent,
  SNAPSHOT_INDENT_UNIT,
  SNAPSHOT_LOCATOR_DELIM,
  SNAPSHOT_PAGE_HEADER,
  SNAPSHOT_PURPOSE_TOKEN
} from '@wdio/devtools-shared'
import type { AccessibilityNode } from '@wdio/devtools-shared'

export interface WebSnapshotOptions {
  inViewportOnly?: boolean
}

/**
 * Walk backwards from `index` to find the nearest ancestor or preceding
 * structural sibling with a non-empty name.  Same-depth nodes are only
 * used when they are structural (img, heading, statictext, …) — never
 * another interactive element.
 */
function inferPurpose(
  nodes: AccessibilityNode[],
  index: number
): string | undefined {
  const myDepth = nodes[index].depth
  for (let i = index - 1; i >= 0; i--) {
    if (nodes[i].depth <= myDepth && nodes[i].name) {
      // Same-depth sibling: only structural elements count
      if (nodes[i].depth === myDepth && INTERACTIVE_ROLES.has(nodes[i].role)) {
        continue
      }
      return nodes[i].name
    }
  }
  return undefined
}

/**
 * Serialize a web accessibility tree into a depth-indented text snapshot.
 *
 * @param nodes   Flat ordered node list from getBrowserAccessibilityTree()
 * @param context  Optional page context for the header line
 * @param options  {@link WebSnapshotOptions}
 */
export function serializeWebSnapshot(
  nodes: AccessibilityNode[],
  context?: { url?: string; title?: string },
  options: WebSnapshotOptions = {}
): string {
  const { inViewportOnly = true } = options

  let header = SNAPSHOT_PAGE_HEADER
  if (context?.title) {
    header += `: ${context.title}`
  }
  if (context?.url) {
    header += ` — ${context.url}`
  }
  header += ']'

  const lines: string[] = [header]

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]

    // When viewport filtering is on, skip nodes that are known to be off-screen.
    // Nodes from a tree captured with inViewportOnly=false will have
    // isInViewport populated; nodes from a pre-filtered tree all have
    // isInViewport=true (or undefined for pre-existing data).
    if (inViewportOnly && node.isInViewport === false) {
      continue
    }

    const indent = SNAPSHOT_INDENT_UNIT.repeat(node.depth + 1) // +1 indents everything under the header
    const isInteractive = INTERACTIVE_ROLES.has(node.role)

    if (isStatictextEchoedByParent(nodes, i)) {
      continue
    }

    // Heading gets level suffix: heading[2]
    const roleLabel =
      node.role === 'heading' && node.level
        ? `heading[${node.level}]`
        : node.role

    if (isInteractive) {
      // No selector → agent can't act on this node; skip entirely
      if (!node.selector) {
        continue
      }
      const purpose = inferPurpose(nodes, i)
      if (node.name) {
        // Show parent context when available — disambiguates
        // duplicate selectors like six "Add to Wishlist" buttons.
        lines.push(
          purpose
            ? `${indent}${roleLabel} "${node.name}" ${SNAPSHOT_PURPOSE_TOKEN} "${purpose}"  ${SNAPSHOT_LOCATOR_DELIM}  ${node.selector}`
            : `${indent}${roleLabel} "${node.name}"  ${SNAPSHOT_LOCATOR_DELIM}  ${node.selector}`
        )
      } else if (purpose) {
        lines.push(
          `${indent}${roleLabel} ${SNAPSHOT_PURPOSE_TOKEN} "${purpose}"  ${SNAPSHOT_LOCATOR_DELIM}  ${node.selector}`
        )
      } else {
        lines.push(
          `${indent}${roleLabel}  ${SNAPSHOT_LOCATOR_DELIM}  ${node.selector}`
        )
      }
    } else {
      // Container / structural: show role + name when present, no selector
      lines.push(
        node.name
          ? `${indent}${roleLabel} "${node.name}"`
          : `${indent}${roleLabel}`
      )
    }
  }

  return lines.join('\n')
}
