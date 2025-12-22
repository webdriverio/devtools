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
}

export interface RunnerOptions {
  framework?: string
  configFile?: string
  configFilePath?: string
  runCapabilities?: Partial<RunCapabilities>
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
}

export enum TestState {
  PASSED = 'passed',
  FAILED = 'failed',
  RUNNING = 'running',
  SKIPPED = 'skipped'
}
