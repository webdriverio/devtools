export interface CommandLogLike {
  timestamp: number
  [key: string]: unknown
}

export interface ConsoleLogLike {
  timestamp: number
  [key: string]: unknown
}

export interface NetworkRequestLike {
  id?: string
  timestamp: number
  startTime?: number
  endTime?: number
  [key: string]: unknown
}

export interface MutationLike {
  timestamp: number
  [key: string]: unknown
}

export type NodeState = 'passed' | 'failed' | 'skipped' | 'pending' | 'running'

export interface NodeError {
  message?: string
  name?: string
  stack?: string
  expected?: unknown
  actual?: unknown
  matcherResult?: {
    expected?: unknown
    actual?: unknown
    message?: string
  }
}

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

export interface PreservedStep {
  uid: string
  title?: string
  fullTitle?: string
  start?: number
  end?: number
  state?: NodeState
  error?: NodeError
}

export interface PreservedAttempt {
  testUid: string
  scope: 'test' | 'suite'
  capturedAt: number
  window: { start: number; end: number }
  test: {
    title?: string
    fullTitle?: string
    file?: string
    callSource?: string
    start?: number
    end?: number
    duration?: number
    state?: NodeState
    error?: NodeError
  }
  steps?: PreservedStep[]
  commands: CommandLogLike[]
  consoleLogs: ConsoleLogLike[]
  networkRequests: NetworkRequestLike[]
  mutations: MutationLike[]
  sources: Record<string, string>
}

export interface ActiveRun {
  commands: CommandLogLike[]
  consoleLogs: ConsoleLogLike[]
  networkRequests: NetworkRequestLike[]
  mutations: MutationLike[]
  sources: Record<string, string>
  nodes: Map<string, TimeWindowNode>
  startedAt: number
}
