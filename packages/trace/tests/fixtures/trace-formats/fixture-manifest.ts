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
  /** `data:image` URIs inlined in the `.trace` streams, which the format before #508 wrote into every frame-snapshot. */
  inlineScreenshots: number
  /** The entries holding frame-snapshot screenshots stored as resources (#508), in stream order. */
  snapshotScreenshots: string[]
  /** Stored stylesheets and fonts listed in `page-resources.ndjson` (#533) whose bytes the zip holds. */
  pageResources: { url: string; kind: string; mimeType: string; size: number }[]
}
