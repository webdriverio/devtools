import type { SuiteStats, TestStats } from '@wdio/reporter'
import type {
  TraceLog,
  TestStatus,
  BaselineSavedWsPayload,
  BaselineClearedWsPayload,
  ReplaceCommandWsPayload
} from '@wdio/devtools-shared'

export type TestStatsFragment = Omit<Partial<TestStats>, 'uid' | 'state'> & {
  uid: string
  state?: TestStatus
  callSource?: string
  featureFile?: string
  featureLine?: number
}

export type SuiteStatsFragment = Omit<
  Partial<SuiteStats>,
  'uid' | 'tests' | 'suites'
> & {
  uid: string
  state?: TestStatus
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
        ? ReplaceCommandWsPayload
        : T extends 'baseline:saved'
          ? BaselineSavedWsPayload
          : T extends 'baseline:cleared'
            ? BaselineClearedWsPayload
            : unknown
}
