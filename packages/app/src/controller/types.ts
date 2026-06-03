import type { SuiteStats, TestStats } from '@wdio/reporter'
import type { TestStatus } from '@wdio/devtools-shared'

// SocketMessage / WsScope / WsPayloadFor are the WS wire format and live in
// @wdio/devtools-shared (§2.1 + §2.5). Re-exported here for back-compat with
// existing import sites; new code should import from shared directly.
export type {
  ControlScope,
  ClearExecutionDataWsPayload,
  SocketMessage,
  TraceScope,
  WsMessageScope,
  WsPayloadFor
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
