export interface TraceMetadata {
  id: string
  url: string
}

declare global {
  interface Element {
    'wdio-ref': string
  }
  interface Window {
    wdioDOMChanges: any[]
    wdioTraceLogs: string[]
    wdioCaptureErrors: string[]
    wdioMetadata: TraceMetadata
  }
}
