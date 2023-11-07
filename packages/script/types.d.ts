export interface TraceMetadata {
  id: string
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
    wdioDOMChanges: TraceMutation[]
    wdioTraceLogs: string[]
    wdioCaptureErrors: string[]
    wdioMetadata: TraceMetadata
    wdioConsoleLogs: ConsoleLogs[]
  }

  interface SimplifiedVNode {
    type: string
    props: Record<string, string> & { children?: SimplifiedVNode | SimplifiedVNode[] }
  }

  interface TraceMutation {
    type: MutationRecordType
    attributeName?: string
    attributeNamespace?: string
    oldValue?: string
    addedNodes: (string | SimplifiedVNode)[]
    target?: string
    removedNodes: string[]
    previousSibling?: string
    nextSibling?: string
    timestamp: number
  }
}
