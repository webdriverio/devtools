import type { WebDriverCommands } from '@wdio/protocols'
import type { Capabilities, Options } from '@wdio/types'

export interface CommandLog {
  command: keyof WebDriverCommands
  args: any[]
  result: any
  error?: Error
  timestamp: number
}

export enum TraceType {
  Standalone = 'standalone',
  Testrunner = 'testrunner'
}

export interface TraceLog {
  mutations: TraceMutation[]
  logs: string[]
  metadata: {
    type: TraceType
    id: string
    url: string
    options: Omit<Options.WebdriverIO, 'capabilities'>
    capabilities: Capabilities.RemoteCapability
    viewport: VisualViewport
  }
  commands: CommandLog[]
}
