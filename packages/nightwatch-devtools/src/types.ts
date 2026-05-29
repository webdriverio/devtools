// Nightwatch-specific types live here. Cross-package types come from @wdio/devtools-shared.

export {
  TraceType,
  type CommandLog,
  type ConsoleLog,
  type DocumentInfo,
  type LogLevel,
  type Metadata,
  type NetworkRequest,
  type PerformanceData,
  type TestStatus,
  type TraceLog
} from '@wdio/devtools-shared'

export interface CommandStackFrame {
  command: string
  callSource?: string
  signature: string
}

export interface TestStats {
  uid: string
  cid: string
  title: string
  fullTitle: string
  parent: string
  state: 'passed' | 'failed' | 'skipped' | 'pending' | 'running'
  start: Date
  end: Date | null
  type: 'test'
  file: string
  retries: number
  _duration: number
  error?: Error
  hooks?: any[]
  callSource?: string
}

export interface NightwatchTestCase {
  passed: number
  failed: number
  errors: number
  skipped: number
  time: string
  assertions: any[]
}

export interface TestFileMetadata {
  suiteTitle: string | null
  suiteLine: number | null
  testNames: string[]
  testLines: number[]
}

export interface StepLocation {
  filePath: string
  line: number
}

export interface SuiteStats {
  uid: string
  cid: string
  title: string
  fullTitle: string
  type: 'suite'
  file: string
  start: Date
  state?: 'pending' | 'running' | 'passed' | 'failed' | 'skipped'
  end?: Date | null
  tests: (string | TestStats)[]
  suites: SuiteStats[]
  hooks: any[]
  _duration: number
  parent?: string
  callSource?: string
}

export interface DevToolsOptions {
  port?: number
  hostname?: string
}

export interface NightwatchBrowser {
  url: (url: string) => Promise<any>
  execute: (script: string | Function, args?: any[]) => Promise<any>
  executeAsync: (script: Function, args?: any[]) => Promise<any>
  pause: (ms: number) => Promise<any>
  capabilities?: Record<string, any>
  desiredCapabilities?: Record<string, any>
  sessionId?: string
  driver?: any
  options?: {
    testEnv?: string
    webdriver?: { host?: string }
    [key: string]: any
  }
  currentTest?: {
    name?: string
    module?: string
    group?: string
    [key: string]: any
  }
  results?: any
  queue?: any
}
