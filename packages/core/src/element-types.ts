/**
 * Framework-agnostic element types used by element extraction scripts,
 * snapshot serializers, and locator generation.
 *
 * These types describe the data structures returned by browser-injectable
 * scripts and mobile page-source parsing. They have no WebdriverIO dependency.
 */

// These describe what the page-side scripts return, so they live beside those
// scripts in `shared` — where the backend, which serves them, can reach them.
export type {
  AccessibilityNode,
  BrowserElementInfo,
  GetBrowserElementsOptions
} from '@wdio/devtools-shared'

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
