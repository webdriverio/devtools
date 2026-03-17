export interface CommandStackFrame {
  command: string
  callSource?: string
  signature: string
}

export interface PerformanceData {
  navigation?: {
    url: string
    timing: {
      loadTime?: number
      domReady?: number
      responseTime?: number
      dnsLookup?: number
      tcpConnection?: number
      serverResponse?: number
    }
  }
  resources?: Array<{
    url: string
    duration: number
    size: number
    type: string
    startTime: number
    responseEnd: number
  }>
}

export interface DocumentInfo {
  url: string
  title: string
  headers: {
    userAgent: string
    language: string
    platform: string
  }
  documentInfo: {
    readyState: string
    referrer: string
    characterSet: string
  }
}

export interface CommandLog {
  command: string
  args: any[]
  result?: any
  error?: Error
  timestamp: number
  callSource?: string
  screenshot?: string
  testUid?: string
  performance?: PerformanceData
  cookies?: string
  documentInfo?: DocumentInfo
}

export enum TraceType {
  Testrunner = 'testrunner'
}

export type LogLevel = 'trace' | 'debug' | 'log' | 'info' | 'warn' | 'error'

export interface ConsoleLog {
  timestamp: number
  type: LogLevel
  args: any[]
  source: string
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

export interface Metadata {
  type: TraceType
  url?: string
  options?: any
  capabilities?: any
  viewport?: any
}

export interface TraceLog {
  mutations: any[]
  logs: string[]
  consoleLogs: ConsoleLog[]
  networkRequests: any[]
  metadata: Metadata
  commands: CommandLog[]
  sources: Record<string, string>
  suites: Record<string, SuiteStats>[]
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
  sessionId?: string
  driver?: any
}

export interface NetworkRequest {
  id: string
  url: string
  method: string
  headers?: Record<string, string>
  cookies?: any[]
  status?: number
  statusText?: string
  timestamp: number
  startTime: number
  endTime?: number
  time?: number
  type: string
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  navigation?: string
  redirectChain?: any[]
  children?: NetworkRequest[]
  response?: {
    fromCache: boolean
    headers: Record<string, string>
    mimeType: string
    status: number
  }
  error?: string
  requestBody?: string
  responseBody?: string
  size?: number
}
