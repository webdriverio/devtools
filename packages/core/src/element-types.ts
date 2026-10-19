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
