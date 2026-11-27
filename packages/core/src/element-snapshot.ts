/**
 * AI-readable snapshot serializers
 *
 * Converts accessibility trees and mobile element trees into depth-indented
 * text files that LLMs can consume without any parsing.
 */

import type {
  AccessibilityNode,
  SnapshotNode,
  SnapshotElement,
  SnapshotResult
} from './element-types.js'

// The serializers live in `trace` because the backend builds the trace for an
// adapter that cannot, and §2.2 bars the backend from importing core.
export {
  serializeWebSnapshot,
  type WebSnapshotOptions
} from '@wdio/devtools-trace/a11y-snapshot'
export {
  serializeMobileSnapshot,
  type MobileSnapshotOptions
} from '@wdio/devtools-trace/mobile-snapshot'

import {
  INTERACTIVE_ROLES,
  isStatictextEchoedByParent,
  xpathLocatorTag,
  type NativePlatform
} from '@wdio/devtools-shared'

import type { JSONElement } from '@wdio/devtools-trace/locators/types'
import { mobileFlatNodes } from '@wdio/devtools-trace/mobile-snapshot'

// ---------------------------------------------------------------------------
// Unified snapshot formatter — web + mobile share the same render pass.
// ---------------------------------------------------------------------------

/** Derive a tag name from a locator prefix (e.g. `//button[contains(., "Submit")]`
 *  or "button*=Submit" → "button"). */
function extractTagFromSelector(selector: string, fallback: string): string {
  const xpathTag = xpathLocatorTag(selector)
  if (xpathTag) {
    return xpathTag
  }
  // Matches tag name followed by a CSS selector combinator or operator.
  // Supports hyphenated custom elements (my-component) and pseudo-classes (:nth-of-type).
  const match = selector.match(
    /^([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*)[*.#\[:=(^$~]/
  )
  if (match) {
    return match[1]
  }
  const spaceMatch = selector.match(/^([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*)\s/)
  if (spaceMatch) {
    return spaceMatch[1]
  }
  return fallback
}

/** Walk backwards to find the nearest structural container name for ∈ context. */
function findContextName(
  nodes: SnapshotNode[],
  index: number
): string | undefined {
  const myDepth = nodes[index].depth
  for (let i = index - 1; i >= 0; i--) {
    if (nodes[i].depth <= myDepth && nodes[i].name) {
      if (nodes[i].depth === myDepth && nodes[i].isInteractive) {
        continue
      }
      // Suppressed tag-interactive nodes (isInteractive=false but role is a
      // mobile-interactable label like 'statictext') shouldn't provide context
      // at same depth — their name is label text, not a container identity.
      // Mirrors mobileInferPurpose which skips same-depth nodes not in
      // MOBILE_STRUCTURAL_ROLES (which excludes 'statictext').
      if (nodes[i].depth === myDepth && nodes[i].role === 'statictext') {
        continue
      }
      return nodes[i].name
    }
  }
  return undefined
}

/**
 * Core formatter — converts a flat SnapshotNode[] into a text tree with
 * eN virtual IDs and an elements map for selector resolution.
 *
 * Platform-agnostic: both web and mobile pipelines feed into this function.
 */
export function buildSnapshot(
  header: string,
  nodes: SnapshotNode[]
): SnapshotResult {
  const selectorCounts = new Map<string, number>()
  for (const node of nodes) {
    if (node.isInteractive && node.selector) {
      selectorCounts.set(
        node.selector,
        (selectorCounts.get(node.selector) ?? 0) + 1
      )
    }
  }

  const lines: string[] = [header]
  const elements: Record<string, SnapshotElement> = {}
  const selectorIndex = new Map<string, number>()
  let counter = 1

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const indent = '  '.repeat(node.depth + 1)

    if (node.isInteractive && node.selector) {
      let selector = node.selector
      const total = selectorCounts.get(selector) ?? 1
      if (total > 1) {
        const idx = selectorIndex.get(selector) ?? 0
        selectorIndex.set(selector, idx + 1)
        selector = `${selector}.instance(${idx})`
      }

      const eId = `e${counter++}`

      const roleLabel =
        node.role === 'heading' && node.level
          ? `heading[${node.level}]`
          : node.role

      const context = findContextName(nodes, i)
      if (node.name && context) {
        lines.push(
          `${indent}${eId}  ${roleLabel} "${node.name}" ∈ "${context}"  →  ${selector}`
        )
      } else if (node.name) {
        lines.push(
          `${indent}${eId}  ${roleLabel} "${node.name}"  →  ${selector}`
        )
      } else if (context) {
        lines.push(
          `${indent}${eId}  ${roleLabel} ∈ "${context}"  →  ${selector}`
        )
      } else {
        lines.push(`${indent}${eId}  ${roleLabel}  →  ${selector}`)
      }

      elements[eId] = {
        selector: node.selector,
        ...(selector !== node.selector ? { qualifiedSelector: selector } : {}),
        tagName: node.tagName,
        role: node.role,
        text: node.name
      }
    } else {
      const roleLabel =
        node.role === 'heading' && node.level
          ? `heading[${node.level}]`
          : node.role
      lines.push(
        node.name
          ? `${indent}${roleLabel} "${node.name}"`
          : `${indent}${roleLabel}`
      )
    }
  }

  return { text: lines.join('\n'), elements }
}

// ---------------------------------------------------------------------------
// Web adapter — AccessibilityNode[] → SnapshotNode[]
// ---------------------------------------------------------------------------

export function accessibilityNodesToSnapshotNodes(
  nodes: AccessibilityNode[],
  options?: { inViewportOnly?: boolean }
): SnapshotNode[] {
  const { inViewportOnly = true } = options ?? {}

  const result: SnapshotNode[] = []

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]

    if (inViewportOnly && node.isInViewport === false) {
      continue
    }

    const isInteractive = INTERACTIVE_ROLES.has(node.role)

    if (isStatictextEchoedByParent(nodes, i)) {
      continue
    }

    // Interactive nodes without a selector can't be acted on — skip them
    // so they don't leak as non-actionable entries in the text tree.
    // Matches the guard in serializeWebSnapshot (line 141).
    if (isInteractive && !node.selector) {
      continue
    }

    const tagName =
      isInteractive && node.selector
        ? extractTagFromSelector(node.selector, node.role)
        : node.role

    result.push({
      role: node.role,
      name: node.name,
      selector: node.selector,
      depth: node.depth,
      isInteractive,
      tagName,
      level: node.level || undefined
    })
  }

  return result
}

// ---------------------------------------------------------------------------
// Mobile adapter — JSONElement tree → SnapshotNode[]
// ---------------------------------------------------------------------------

export function jsonElementToSnapshotNodes(
  root: JSONElement,
  platform: NativePlatform,
  options?: {
    inViewportOnly?: boolean
    viewport?: { width: number; height: number }
    sourceXML?: string
  }
): SnapshotNode[] {
  return mobileFlatNodes(root, platform, options).map((m) => ({
    role: m.role,
    name: m.name,
    selector: m.selector,
    depth: m.depth,
    isInteractive: m.isInteractive,
    tagName: m.tagName,
    level: undefined
  }))
}
