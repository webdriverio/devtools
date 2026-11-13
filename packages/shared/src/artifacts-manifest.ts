import type { ParentTraceContext } from './trace-context.js'
import type { TestMetadataEntry, TestStatus, TraceFormat } from './types.js'

/** The retry key of attempt `attempt` of `uid`; attempt 0 keeps the bare uid. */
export function retryKeyOf(uid: string, attempt: number): string {
  return attempt > 0 ? `${uid}-retry${attempt}` : uid
}

/** One artifact produced (or, when `retained` is false, decided-against) by a
 *  trace-mode run — a trace slice, a screencast video, or a per-test screenshot. */
export interface TraceArtifact {
  kind: 'trace' | 'video' | 'screenshot'
  /** Relative to the manifest's directory, `/`-separated. */
  path: string
  scope: 'session' | 'spec' | 'test'
  /** specFile for spec scope; testUid for test scope, `${testUid}-retry${n}` for retry n. */
  key?: string
  testUids: string[]
  /** false = decided-not-to-write (reported, not written). Always true today. */
  retained: boolean
}

/** One attempt of a test, with the trace context minted when it started. */
export interface TestAttemptRecord {
  attempt: number
  state?: TestStatus
  startTime: number
  endTime?: number
  traceId: string
  spanId: string
  /** Set on the attempt that decided the test's outcome; absent in manifests that predate it. */
  final?: boolean
  error?: string
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
  attempts?: TestAttemptRecord[]
}

export const ARTIFACTS_MANIFEST_VERSION = 2

export interface ArtifactsManifest {
  manifestVersion: typeof ARTIFACTS_MANIFEST_VERSION
  sessionId: string
  format: TraceFormat
  artifacts: TraceArtifact[]
  tests: ArtifactManifestTest[]
  runId?: string
  /** Trace context inherited from a `TRACEPARENT` set by the CI job that launched the run. */
  parent?: ParentTraceContext
  browserName?: string
  browserVersion?: string
  platformName?: string
}
