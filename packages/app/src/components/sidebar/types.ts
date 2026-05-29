export interface TestEntry {
  uid: string
  state?: string
  label: string
  callSource?: string
  children: TestEntry[]
  type: 'suite' | 'test'
  specFile?: string
  fullTitle?: string
  featureFile?: string
  featureLine?: number
  suiteType?: string
}

export interface RunCapabilities {
  canRunSuites: boolean
  canRunTests: boolean
  canRunAll: boolean
}

export interface RunnerOptions {
  framework?: string
  configFile?: string
  configFilePath?: string
  runCapabilities?: Partial<RunCapabilities>
  rerunCommand?: string
  launchCommand?: string
}

export interface TestRunDetail {
  uid: string
  entryType: 'suite' | 'test'
  specFile?: string
  fullTitle?: string
  label?: string
  callSource?: string
  configFile?: string
  featureFile?: string
  featureLine?: number
  suiteType?: string
  preserveBaseline?: boolean
}

import type { TestStatus } from '@wdio/devtools-shared'

/**
 * Enum-style accessor for the canonical TestStatus values. Use the
 * shared TestStatus type for type annotations; this object is for
 * readable value comparisons (`state === TestState.PASSED`).
 */
export const TestState = {
  PASSED: 'passed',
  FAILED: 'failed',
  RUNNING: 'running',
  SKIPPED: 'skipped',
  PENDING: 'pending'
} as const satisfies Record<string, TestStatus>

export type { TestStatus } from '@wdio/devtools-shared'
