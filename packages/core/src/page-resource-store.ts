import {
  DEFAULT_TRACE_RESOURCES,
  isPageResource,
  isResourceReRead,
  MAX_STORED_RESOURCE_KEYS,
  resourceUrlKey,
  PAGE_RESOURCE_SETTLE_POLL_MS,
  PAGE_RESOURCE_SETTLE_TIMEOUT_MS,
  type CollectorDrainPayload,
  type PageResource,
  type ResourceReRead,
  type TraceResourcesMode
} from '@wdio/devtools-shared'

/** The run's stored stylesheets and fonts, one per URL, and the collector's reads of them, held for the trace writer only. */
export class PageResourceStore {
  /** What a drain asks the page for: `none` in live mode, so a live drain reads nothing back. */
  mode: TraceResourcesMode = 'none'
  readonly resources: PageResource[] = []
  readonly reReads: ResourceReRead[] = []
  /** Reads the page reported still in flight at the last drain that said. */
  pending = 0
  #urls = new Set<string>()
  /** `resourceUrlKey`s of what is stored, which a trace drain hands the page so it does not read them again. */
  readonly storedKeys: string[] = []

  /** Sets the mode from the run's `mode` and `traceResources` options. */
  configure(options: {
    mode?: string
    traceResources?: TraceResourcesMode
  }): void {
    this.mode =
      options.mode === 'trace'
        ? (options.traceResources ?? DEFAULT_TRACE_RESOURCES)
        : 'none'
  }

  /** Takes the page-resource fields of a drained `getTraceData()` payload. */
  ingest(payload: CollectorDrainPayload): void {
    if (Array.isArray(payload.pageResources)) {
      for (const resource of payload.pageResources.filter(isPageResource)) {
        if (!this.#urls.has(resource.url)) {
          this.#urls.add(resource.url)
          this.resources.push(resource)
          if (this.storedKeys.length < MAX_STORED_RESOURCE_KEYS) {
            this.storedKeys.push(resourceUrlKey(resource.url))
          }
        }
      }
    }
    if (Array.isArray(payload.resourceReReads)) {
      this.reReads.push(...payload.resourceReReads.filter(isResourceReRead))
    }
    if (typeof payload.pendingResources === 'number') {
      this.pending = payload.pendingResources
    }
  }

  /** Drains again, bounded, while the page has reads in flight, so the last document's reads reach the store. */
  async settle(drain: () => Promise<unknown>): Promise<void> {
    if (this.mode === 'none') {
      return
    }
    const deadline = Date.now() + PAGE_RESOURCE_SETTLE_TIMEOUT_MS
    while (this.pending > 0 && Date.now() < deadline) {
      await new Promise((resolve) =>
        setTimeout(resolve, PAGE_RESOURCE_SETTLE_POLL_MS)
      )
      // A drain that reaches no collector reports nothing; that ends the wait.
      this.pending = 0
      await drain()
    }
  }
}
