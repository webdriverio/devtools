import type {
  CommandLog,
  ConsoleLog,
  Metadata,
  NetworkRequest,
  ScreencastFrame,
  TestError,
  TestStatus,
  TraceMutation
} from '@wdio/devtools-shared'

// Backend storage uses the canonical shared types. The `*Like` aliases below
// are kept so existing backend code that referenced them continues to compile;
// new code should use the shared types directly.
export type CommandLogLike = CommandLog
export type ConsoleLogLike = ConsoleLog
export type NetworkRequestLike = NetworkRequest

// `TraceMutation` in shared is deliberately the Node-safe version of the
// browser-side shape — string literals instead of DOM node types — so it flows
// here without dragging the DOM lib into shared's compilation.
export type MutationLike = TraceMutation

export type NodeState = TestStatus
export type NodeError = TestError

export interface TimeWindowNode {
  uid: string
  kind: 'suite' | 'test'
  title?: string
  fullTitle?: string
  file?: string
  callSource?: string
  start?: number
  end?: number
  state?: NodeState
  error?: NodeError
  childUids: string[]
}

export type { PreservedAttempt, PreservedStep } from '@wdio/devtools-shared'

export interface ActiveRun {
  commands: CommandLog[]
  consoleLogs: ConsoleLog[]
  networkRequests: NetworkRequest[]
  mutations: MutationLike[]
  sources: Record<string, string>
  nodes: Map<string, TimeWindowNode>
  startedAt: number
  /** Last `metadata` frame the worker sent. Preserve & Rerun never needed it;
   *  a trace artifact does — it carries the session identity and capabilities
   *  the viewer reads. */
  metadata?: Metadata
  /** Raw `logs` frames, the trace's transcript source. Only the JS adapters
   *  send these, so this is routinely empty. */
  traceLogs: string[]
  /** Dense screencast frames for the trace filmstrip. The JS adapters hand
   *  their recorder's buffer straight to the exporter in-process; an adapter
   *  that exports through here has to send them, so they accumulate like any
   *  other stream. Empty unless the adapter asked for a filmstrip. */
  screencastFrames: ScreencastFrame[]
}
