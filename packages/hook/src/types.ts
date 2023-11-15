import type { WebDriverCommands } from '@wdio/protocols'
import type { Capabilities, Options } from '@wdio/types'

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

export interface TraceLog {
  mutations: TraceMutation[]
  logs: string[]
  consoleLogs: ConsoleLogs[]
  metadata: {
    type: TraceType
    url: string
    options: Omit<Options.WebdriverIO, 'capabilities'>
    capabilities: Capabilities.RemoteCapability
    viewport: VisualViewport
  }
  commands: CommandLog[],
  sources: Record<string, string>
}
