// WDIO-dependent element extraction wrappers.
// Framework-agnostic types, serializers, scripts, and locator generation live
// in @wdio/devtools-core and are re-exported here for backward compatibility.

export { getInteractableBrowserElements } from './browser-elements.js'
export type {
  BrowserElementInfo,
  GetBrowserElementsOptions
} from './browser-elements.js'

export { getBrowserAccessibilityTree } from './accessibility-tree.js'
export type { AccessibilityNode } from './accessibility-tree.js'

export { getMobileVisibleElements } from './mobile-elements.js'
export type {
  MobileElementInfo,
  GetMobileElementsOptions
} from './mobile-elements.js'

export { getElements } from './get-elements.js'
export type { VisibleElementsResult } from './get-elements.js'

export { serializeWebSnapshot, serializeMobileSnapshot } from './snapshot.js'
export type { WebSnapshotOptions, MobileSnapshotOptions } from './snapshot.js'
export type { JSONElement } from './locators/index.js'

export { getSnapshot } from './get-snapshot.js'
export type { GetSnapshotOptions } from './get-snapshot.js'
export type { SnapshotResult, SnapshotElement } from './snapshot.js'
