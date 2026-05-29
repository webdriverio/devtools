import type {
  CommandLog,
  ConsoleLog,
  NetworkRequest,
  TestError,
  TestStatus
} from '@wdio/devtools-shared'

// Backend storage uses the canonical shared types. The `*Like` aliases below
// are kept so existing backend code that referenced them continues to compile;
// new code should use the shared types directly.
export type CommandLogLike = CommandLog
export type ConsoleLogLike = ConsoleLog
export type NetworkRequestLike = NetworkRequest

// Mutations stay loose: the concrete shape (TraceMutation) lives in
// packages/script (browser-side, depends on DOM types) and isn't safe to
// import here.
export interface MutationLike {
  timestamp: number
  [key: string]: unknown
}

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
}
