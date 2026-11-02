/**
 * AI-readable snapshot serializers — re-exported from @wdio/devtools-core.
 */

export {
  serializeWebSnapshot,
  serializeMobileSnapshot,
  buildSnapshot,
  accessibilityNodesToSnapshotNodes,
  jsonElementToSnapshotNodes
} from '@wdio/devtools-core/element-snapshot'
export type {
  WebSnapshotOptions,
  MobileSnapshotOptions
} from '@wdio/devtools-core/element-snapshot'
export type {
  SnapshotNode,
  SnapshotElement,
  SnapshotResult
} from '@wdio/devtools-core/element-types'
