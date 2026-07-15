/**
 * Framework-agnostic element types used by element extraction scripts,
 * snapshot serializers, and locator generation.
 *
 * These types describe the data structures returned by browser-injectable
 * scripts and mobile page-source parsing. They have no WebdriverIO dependency.
 */

export interface AccessibilityNode {
  role: string
  name: string
  selector: string
  depth: number
  level: number | string
  disabled: string
  checked: string
  expanded: string
  selected: string
  pressed: string
  required: string
  readonly: string
  /** Whether the element's bounding rect intersects the viewport. */
  isInViewport?: boolean
}

export interface BrowserElementInfo {
  tagName: string
  name: string // computed accessible name (ARIA spec)
  type: string
  value: string
  href: string
  selector: string
  isInViewport: boolean
  boundingBox?: { x: number; y: number; width: number; height: number }
}

export interface GetBrowserElementsOptions {
  includeBounds?: boolean
  /** Only return elements whose bounding rect intersects the viewport (default true). */
  inViewportOnly?: boolean
}

// Re-export mobile types from locators for convenience.
// Downstream consumers can also import directly from @wdio/devtools-core/locators.
export type { JSONElement } from './locators/types.js'

/**
 * Flat intermediate node shared by both web and mobile snapshot pipelines.
 * Both adapters (web: AccessibilityNode[], mobile: JSONElement tree) convert
 * to this shape before buildSnapshot() renders them.
 */
export interface SnapshotNode {
  role: string
  name: string
  selector: string
  depth: number
  isInteractive: boolean
  tagName: string
  level?: number | string
}

/** Entry in the elements map returned by getSnapshot(). */
export interface SnapshotElement {
  /** Raw selector — may need .instance(N) on mobile when duplicates exist. */
  selector: string
  /** Selector with .instance(N) suffix — only set when it differs from `selector` (duplicate disambiguation). */
  qualifiedSelector?: string
  tagName: string
  role: string
  text: string
}

/** Return type of getSnapshot(). */
export interface SnapshotResult {
  text: string
  elements: Record<string, SnapshotElement>
}
