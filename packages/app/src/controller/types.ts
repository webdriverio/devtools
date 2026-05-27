import type { SuiteStats, TestStats } from '@wdio/reporter'
import type {
  TraceLog,
  CommandLog,
  PreservedAttempt
} from '@wdio/devtools-service/types'

export type TestStatsFragment = Omit<Partial<TestStats>, 'uid' | 'state'> & {
  uid: string
  state?: 'running' | 'passed' | 'failed' | 'pending' | 'skipped'
  callSource?: string
  featureFile?: string
  featureLine?: number
}

export type SuiteStatsFragment = Omit<
  Partial<SuiteStats>,
  'uid' | 'tests' | 'suites'
> & {
  uid: string
  state?: 'running' | 'passed' | 'failed' | 'pending'
  tests?: TestStatsFragment[]
  suites?: SuiteStatsFragment[]
  callSource?: string
  featureFile?: string
  featureLine?: number
  type?: string
  file?: string
}

export interface SocketMessage<
  T extends
    | keyof TraceLog
    | 'testStopped'
    | 'clearExecutionData'
    | 'replaceCommand'
    | 'baseline:saved'
    | 'baseline:cleared' =
    | keyof TraceLog
    | 'testStopped'
    | 'clearExecutionData'
    | 'replaceCommand'
    | 'baseline:saved'
    | 'baseline:cleared'
> {
  scope: T
  data: T extends keyof TraceLog
    ? TraceLog[T]
    : T extends 'clearExecutionData'
      ? {
          uid?: string
          entryType?: 'suite' | 'test'
          clearSuiteTree?: boolean
        }
      : T extends 'replaceCommand'
        ? { oldTimestamp: number; command: CommandLog }
        : T extends 'baseline:saved'
          ? { testUid: string; attempt: PreservedAttempt }
          : T extends 'baseline:cleared'
            ? { testUid: string }
            : unknown
}
