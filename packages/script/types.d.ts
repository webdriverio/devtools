import type { DataCollectorType } from './src/collector.ts'
import type { ConsoleLog as ConsoleLogImport } from './src/collectors/consoleLogs.ts'

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
  type ConsoleLogs = ConsoleLogImport

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
