import type { DataCollectorType } from './src/collector.ts'

export interface TraceMetadata {
  url: string
  viewport: VisualViewport
}

declare global {
  interface Element {
    'wdio-ref': string
  }

  interface ConsoleLogs {
    type: 'log' | 'info' | 'warn' | 'error'
    args: any[]
    timestamp: number
  }

  interface Window {
    wdioTraceCollector: DataCollectorType
  }

  interface SimplifiedVNode {
    type: string
    props: Record<string, string> & { children?: SimplifiedVNode | SimplifiedVNode[] }
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
  }
}
