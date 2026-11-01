/** What a fixture zip held when it was reduced, counted from its raw entries rather than through the reader under test. */
export interface TraceFormatManifest {
  source: string
  runner?: string
  browserName?: string
  commands: {
    count: number
    failed: number
    titles: string[]
    withSnapshotText: number
    withCallSource: number
  }
  consoleLogs: number
  networkRequests: { count: number; urls: string[] }
  mutations: { count: number; documentAnchors: number }
  /** Screencast frames in timeline order, by the resource stem each reduced image carries as its marker. */
  frames: string[]
  sourceFiles: string[]
  transcript: boolean
}
