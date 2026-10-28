import type { TestMetadataEntry, TraceFormat } from './types.js'

/** One artifact produced (or, when `retained` is false, decided-against) by a
 *  trace-mode run — a trace slice, a screencast video, or a per-test screenshot. */
export interface TraceArtifact {
  kind: 'trace' | 'video' | 'screenshot'
  path: string
  scope: 'session' | 'spec' | 'test'
  /** specFile for spec scope; testUid for test scope, `${testUid}-retry${n}` for retry n. */
  key?: string
  testUids: string[]
  /** false = decided-not-to-write (reported, not written). Always true today. */
  retained: boolean
}

/** One test's outcome as recorded at export time. Field types track
 *  TestMetadataEntry; adds the keying uid, drops trace-only ancestry. */
export interface ArtifactManifestTest extends Pick<
  TestMetadataEntry,
  | 'title'
  | 'specFile'
  | 'state'
  | 'attempt'
  | 'startTime'
  | 'endTime'
  | 'durationMs'
  | 'error'
> {
  uid: string
}

export interface ArtifactsManifest {
  sessionId: string
  format: TraceFormat
  artifacts: TraceArtifact[]
  tests: ArtifactManifestTest[]
}
