/**
 * AI-readable snapshot serializers
 *
 * Converts accessibility trees and mobile element trees into depth-indented
 * text files that LLMs can consume without any parsing.
 */

import type { AccessibilityNode } from './accessibility-tree.js'
import type { JSONElement } from './locators/types.js'

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
 * Walk backwards from `index` to find the nearest ancestor with a non-empty name.
 * Returns that name, or undefined if none found.
 */
function inferPurpose(
  nodes: AccessibilityNode[],
  index: number
): string | undefined {
  const myDepth = nodes[index].depth
  for (let i = index - 1; i >= 0; i--) {
    if (nodes[i].depth < myDepth && nodes[i].name) {
      return nodes[i].name
    }
  }
  return undefined
}

/**
 * Serialize a web accessibility tree into a depth-indented text snapshot.
 *
 * @param nodes  Flat ordered node list from getBrowserAccessibilityTree()
 * @param context  Optional page context for the header line
 */
export function serializeWebSnapshot(
  nodes: AccessibilityNode[],
  context?: { url?: string; title?: string }
): string {
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
    const indent = '  '.repeat(node.depth + 1) // +1 indents everything under the header
    const isInteractive = INTERACTIVE_ROLES.has(node.role)

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
      if (node.name) {
        lines.push(`${indent}${roleLabel} "${node.name}"  →  ${node.selector}`)
      } else {
        const purpose = inferPurpose(nodes, i)
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

function walkMobileTree(
  element: JSONElement,
  platform: 'android' | 'ios',
  depth: number,
  lines: string[],
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
      identity || parentIdentity
    )
  }
}

/**
 * Serialize a mobile element tree into a depth-indented text snapshot.
 *
 * @param root     Root JSONElement from the page source XML parse
 * @param context  Platform, optional device name and viewport
 */
export function serializeMobileSnapshot(
  root: JSONElement,
  context: {
    platform: 'android' | 'ios'
    deviceName?: string
    viewport?: { width: number; height: number }
  }
): string {
  const { platform, deviceName, viewport } = context

  let header = `[${platform}`
  if (deviceName) {
    header += ` — ${deviceName}`
  }
  if (viewport) {
    header += ` (${viewport.width}×${viewport.height})`
  }
  header += ']'

  const lines: string[] = [header]
  walkMobileTree(root, platform, 1, lines)
  return lines.join('\n')
}
