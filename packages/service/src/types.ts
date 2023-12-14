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
}

export enum TraceType {
  Standalone = 'standalone',
  Testrunner = 'testrunner'
}

export interface Metadata {
  type: TraceType
  url: string
  options: Omit<Options.WebdriverIO, 'capabilities'>
  capabilities: Capabilities.RemoteCapability
  viewport: VisualViewport
}

export interface TraceLog {
  mutations: TraceMutation[]
  logs: string[]
  consoleLogs: ConsoleLogs[]
  metadata: Metadata
  commands: CommandLog[]
  sources: Record<string, string>
  suites?: Record<string, SuiteStats>[]
}

export interface ServiceOptions {
  /**
   * port to launch the application on (default: random)
   */
  port?: number
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
