import type { SuiteStats, TestStats } from '@wdio/reporter'
import type { TraceLog, CommandLog } from '@wdio/devtools-service/types'

export type TestStatsFragment = Omit<Partial<TestStats>, 'uid'> & { uid: string }

export type SuiteStatsFragment = Omit<
  Partial<SuiteStats>,
  'uid' | 'tests' | 'suites'
> & {
  uid: string
  state?: 'running' | 'passed' | 'failed' | 'pending'
  tests?: TestStatsFragment[]
  suites?: SuiteStatsFragment[]
}

export interface SocketMessage<
  T extends
    | keyof TraceLog
    | 'testStopped'
    | 'clearExecutionData'
    | 'replaceCommand' =
    | keyof TraceLog
    | 'testStopped'
    | 'clearExecutionData'
    | 'replaceCommand'
> {
  scope: T
  data: T extends keyof TraceLog
    ? TraceLog[T]
    : T extends 'clearExecutionData'
      ? { uid?: string; entryType?: 'suite' | 'test' }
      : T extends 'replaceCommand'
        ? { oldTimestamp: number; command: CommandLog }
        : unknown
}
