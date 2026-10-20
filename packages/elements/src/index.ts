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

export type { JSONElement } from './locators/index.js'

export { getSnapshot } from './get-snapshot.js'
export type { GetSnapshotOptions, GetSnapshotResult } from './get-snapshot.js'
export { SnapshotError } from '@wdio/snapshot'
export type {
  CandidateKind,
  SnapshotCandidate,
  SnapshotNode,
  SnapshotRef
} from '@wdio/snapshot'
