import type { DataCollectorType } from './src/collector.ts'
import type {
  ConsoleLog,
  NetworkRequest as SharedNetworkRequest
} from '@wdio/devtools-shared'

export type { NetworkRequest } from '@wdio/devtools-shared'

export interface TraceMetadata {
  url: string
  viewport: VisualViewport
}

export interface SimplifiedVNode {
  type: string
  props: Record<string, string> & {
    children?: SimplifiedVNode | SimplifiedVNode[]
  }
}

declare global {
  type ConsoleLogs = ConsoleLog
  type NetworkRequest = SharedNetworkRequest

  interface Element {
    'wdio-ref': string
  }

  interface Window {
    wdioTraceCollector: DataCollectorType
  }

  interface TraceMutation {
    type: MutationRecordType
    attributeName?: string
    attributeNamespace?: string
    attributeValue?: string
    newTextContent?: string
    oldValue?: string
    addedNodes: (string | SimplifiedVNode)[]
    target?: string
    removedNodes: string[]
    previousSibling?: string
    nextSibling?: string
    timestamp: number
    url?: string
  }
}
