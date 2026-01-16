import type { WebDriverCommands } from '@wdio/protocols'
import type { Capabilities, Options } from '@wdio/types'
import type { SuiteStats } from '@wdio/reporter'

export interface CommandLog {
  command: keyof WebDriverCommands
  args: any[]
  result: any
  error?: Error
  timestamp: number
  callSource: string
  screenshot?: string
}

export enum TraceType {
  Standalone = 'standalone',
  Testrunner = 'testrunner'
}

export interface Metadata {
  type: TraceType
  url: string
  options: Omit<Options.WebdriverIO, 'capabilities'>
  capabilities: Capabilities.W3CCapabilities
  viewport: VisualViewport
}

export interface NetworkRequest {
  id: string
  url: string
  method: string
  status?: number
  statusText?: string
  type: string
  initiator?: string
  size?: number
  time?: number
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  requestBody?: string
  responseBody?: string
  timestamp: number
  startTime: number
  endTime?: number
  error?: string
}

export interface TraceLog {
  mutations: TraceMutation[]
  logs: string[]
  consoleLogs: ConsoleLogs[]
  networkRequests: NetworkRequest[]
  metadata: Metadata
  commands: CommandLog[]
  sources: Record<string, string>
  suites?: Record<string, SuiteStats>[]
}

export interface ExtendedCapabilities extends WebdriverIO.Capabilities {
  'wdio:devtoolsOptions'?: ServiceOptions
}

export interface ServiceOptions {
  /**
   * port to launch the application on (default: random)
   */
  port?: number
  /**
   * hostname to launch the application on
   * @default localhost
   */
  hostname?: string
  /**
   * capabilities used to launch the devtools application
   * @default
   * ```ts
   * {
   *   browserName: 'chrome',
   *   'goog:chromeOptions': {
   *     args: ['--window-size=1200,800']
   *   }
   * }
   */
  devtoolsCapabilities?: WebdriverIO.Capabilities
}

declare namespace WebdriverIO {
  interface ServiceOption extends ServiceOptions {}
  interface Capabilities {}
}

declare module '@wdio/reporter' {
  interface TestStats {
    file?: string
    line?: number
    column?: number
  }

  interface SuiteStats {
    line?: string
  }
}
