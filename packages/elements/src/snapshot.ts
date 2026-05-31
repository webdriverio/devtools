/**
 * AI-readable snapshot serializers
 *
 * Converts accessibility trees and mobile element trees into depth-indented
 * text files that LLMs can consume without any parsing.
 */

import type { AccessibilityNode } from './accessibility-tree.js'
import type { JSONElement } from './locators/types.js'
import { parseAndroidBounds, parseIOSBounds } from './locators/xml-parsing.js'

/**
 * Roles that can be interacted with — rendered with `→ selector`.
 * Structural roles (heading, img, form, nav, …) are intentionally excluded.
 */
const INTERACTIVE_ROLES = new Set([
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

export interface WebSnapshotOptions {
  /** Only include nodes whose bounding rect intersects the viewport (default true). */
  inViewportOnly?: boolean
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

  let header = '[Page'
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

    const indent = '  '.repeat(node.depth + 1) // +1 indents everything under the header
    const isInteractive = INTERACTIVE_ROLES.has(node.role)

    // Skip statictext that merely echoes the parent link/button name.
    // Example: link "Highlights" → a*=Highlights doesn't need
    //   statictext "Highlights" as a child because it adds no information.
    if (node.role === 'statictext' && node.name) {
      let echoedByParent = false
      for (let j = i - 1; j >= 0; j--) {
        if (nodes[j].depth < node.depth) {
          const parentRole = nodes[j].role
          const parentName = nodes[j].name
          if (
            INTERACTIVE_ROLES.has(parentRole) &&
            parentName &&
            parentName.includes(node.name)
          ) {
            echoedByParent = true
          }
          break // only check the immediate structural parent
        }
      }
      if (echoedByParent) {
        continue
      }
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
            ? `${indent}${roleLabel} "${node.name}" ∈ "${purpose}"  →  ${node.selector}`
            : `${indent}${roleLabel} "${node.name}"  →  ${node.selector}`
        )
      } else {
        if (purpose) {
          lines.push(
            `${indent}${roleLabel} ∈ "${purpose}"  →  ${node.selector}`
          )
        } else {
          lines.push(`${indent}${roleLabel}  →  ${node.selector}`)
        }
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

// ---------------------------------------------------------------------------
// Mobile snapshot helpers
// ---------------------------------------------------------------------------

/** Shorten fully-qualified Android/iOS class names to the last segment. */
function simplifyTag(tagName: string): string {
  const dot = tagName.lastIndexOf('.')
  if (dot !== -1) {
    return tagName.slice(dot + 1)
  }
  // iOS: strip XCUIElementType prefix
  return tagName.replace(/^XCUIElementType/, '')
}

function getBestAndroidLocator(
  attrs: JSONElement['attributes']
): string | undefined {
  if (attrs['content-desc']) {
    return `accessibility-id:${attrs['content-desc']}`
  }
  if (attrs['resource-id']) {
    return `id:${attrs['resource-id']}`
  }
  if (attrs.text) {
    return `text:${attrs.text}`
  }
  return undefined
}

function getBestIOSLocator(
  attrs: JSONElement['attributes']
): string | undefined {
  if (attrs.name) {
    return `accessibility-id:${attrs.name}`
  }
  if (attrs.label) {
    return `label:${attrs.label}`
  }
  if (attrs.value) {
    return `value:${attrs.value}`
  }
  return undefined
}

function getMobileNodeIdentity(
  attrs: JSONElement['attributes'],
  platform: 'android' | 'ios'
): string {
  if (platform === 'android') {
    return attrs['content-desc'] || attrs.text || ''
  }
  return attrs.name || attrs.label || attrs.value || attrs.text || ''
}

function isMobileInteractive(
  element: JSONElement,
  platform: 'android' | 'ios'
): boolean {
  const attrs = element.attributes
  if (platform === 'android') {
    return attrs.clickable === 'true' || attrs['long-clickable'] === 'true'
  }
  // iOS: accessible="true" or a type known to be interactive
  return attrs.accessible === 'true'
}

interface WalkMobileOptions {
  inViewportOnly: boolean
  viewport: { width: number; height: number }
}

function isMobileInViewport(
  element: JSONElement,
  platform: 'android' | 'ios',
  viewport: { width: number; height: number }
): boolean {
  const bounds =
    platform === 'android'
      ? parseAndroidBounds(element.attributes.bounds || '')
      : parseIOSBounds(element.attributes)

  // Elements without explicit bounds dimensions default to "in viewport"
  // so we don't silently drop content from sources that omit bounds info.
  if (bounds.width === 0 && bounds.height === 0) {
    return true
  }

  return (
    bounds.x >= 0 &&
    bounds.y >= 0 &&
    bounds.width > 0 &&
    bounds.height > 0 &&
    bounds.x + bounds.width <= viewport.width &&
    bounds.y + bounds.height <= viewport.height
  )
}

function walkMobileTree(
  element: JSONElement,
  platform: 'android' | 'ios',
  depth: number,
  lines: string[],
  walkOpts: WalkMobileOptions,
  parentIdentity?: string
): void {
  const attrs = element.attributes
  const tag = simplifyTag(element.tagName)
  const indent = '  '.repeat(depth)
  const identity = getMobileNodeIdentity(attrs, platform)
  const interactive = isMobileInteractive(element, platform)

  const locator =
    platform === 'android'
      ? getBestAndroidLocator(attrs)
      : getBestIOSLocator(attrs)

  if (walkOpts.inViewportOnly) {
    const inViewport = isMobileInViewport(element, platform, walkOpts.viewport)

    if (interactive && !inViewport) {
      // Interactive element off-screen — skip entirely.
      // Still recurse into children (e.g. a scrollable list whose items
      // extend beyond the viewport but the scroll container itself is in view).
      for (const child of element.children || []) {
        walkMobileTree(child, platform, depth + 1, lines, walkOpts,
          identity || parentIdentity)
      }
      return
    }

    if (!interactive && !inViewport) {
      // Container fully off-screen — collapse to a single label.
      lines.push(
        identity
          ? `${indent}⋯ ${tag} "${identity}" (off-screen)`
          : `${indent}⋯ ${tag} (off-screen)`
      )
      // Do NOT recurse into children of an off-screen container.
      return
    }
  }

  if (interactive && locator) {
    if (identity) {
      lines.push(`${indent}${tag} "${identity}"  →  ${locator}`)
    } else if (parentIdentity) {
      lines.push(`${indent}${tag} ∈ "${parentIdentity}"  →  ${locator}`)
    } else {
      lines.push(`${indent}${tag}  →  ${locator}`)
    }
  } else {
    // Container or non-locatable: show tag + identity if any
    lines.push(identity ? `${indent}${tag} "${identity}"` : `${indent}${tag}`)
  }

  for (const child of element.children || []) {
    walkMobileTree(
      child,
      platform,
      depth + 1,
      lines,
      walkOpts,
      identity || parentIdentity
    )
  }
}

export interface MobileSnapshotOptions {
  /** Only include elements whose bounds intersect the viewport (default true). */
  inViewportOnly?: boolean
}

/**
 * Serialize a mobile element tree into a depth-indented text snapshot.
 *
 * @param root     Root JSONElement from the page source XML parse
 * @param context  Platform, optional device name and viewport.
 *                 Viewport dimensions are required when `inViewportOnly` is true.
 * @param options  {@link MobileSnapshotOptions}
 */
export function serializeMobileSnapshot(
  root: JSONElement,
  context: {
    platform: 'android' | 'ios'
    deviceName?: string
    viewport?: { width: number; height: number }
  },
  options: MobileSnapshotOptions = {}
): string {
  const { platform, deviceName, viewport } = context
  const { inViewportOnly = true } = options

  const effectiveViewport = viewport ?? { width: 9999, height: 9999 }

  let header = `[${platform}`
  if (deviceName) {
    header += ` — ${deviceName}`
  }
  if (viewport) {
    header += ` (${viewport.width}×${viewport.height})`
  }
  header += ']'

  const lines: string[] = [header]
  walkMobileTree(root, platform, 1, lines, {
    inViewportOnly,
    viewport: effectiveViewport
  })
  return lines.join('\n')
}
