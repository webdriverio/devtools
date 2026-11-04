import {
  getRequestType,
  isSkippedResourceHost,
  PAGE_RESOURCE_LIMITS,
  PAGE_RESOURCE_READ_TIMEOUT_MS,
  pageResourceKind,
  pageResourceMimeType,
  resourceUrlKey,
  type PageResource,
  type ResourceReRead,
  type TraceDrainOptions
} from '@wdio/devtools-shared'
import { log } from '../logger.js'
import { resourceTimingUrl } from './network-helpers.js'

/** The loads a stylesheet or font comes from: a `<link>`, or a stylesheet's own `@import` and `url()`. */
const CANDIDATE_INITIATORS = new Set(['link', 'css'])

/** URL types read back only to be thrown away, skipped before the read. */
const NEVER_STORED = new Set(['image', 'script', 'document'])

const MAX_CONCURRENT_READS = 4

/** A read's own Resource Timing entry starts within this many ms of the call; the slack covers coarsened timers. */
const OWN_ENTRY_TOLERANCE_MS = 20

/** The load a Resource Timing entry reports, as far as this collector needs it. */
export interface ObservedLoad {
  name: string
  initiatorType: string
  startTime: number
  decodedBodySize?: number
}

interface Read {
  url: string
  /** `performance.now()` when the read started, to recognise its own entry. */
  start: number
}

/** What one trace-mode drain returns: what finished, the reads it started, and how many are still to come. */
export interface PageResourceDrain {
  pageResources: PageResource[]
  resourceReReads: ResourceReRead[]
  pendingResources: number
}

function timeOrigin(): number {
  const origin = performance?.timeOrigin
  return typeof origin === 'number' && origin > 0
    ? origin
    : Date.now() - performance.now()
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function isSameOrigin(url: string): boolean {
  try {
    return new URL(url).origin === location.origin
  } catch {
    return false
  }
}

/** A same-origin stylesheet the page parsed, as text, for one whose bytes cannot be read again. */
function parsedStylesheetText(url: string): string | undefined {
  for (const sheet of Array.from(document.styleSheets)) {
    if (sheet.href !== url) {
      continue
    }
    try {
      return Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n')
    } catch {
      return undefined
    }
  }
  return undefined
}

/** Reads back, when a trace drain asks, the stylesheets and fonts the page loaded, through the unpatched fetch and from the HTTP cache. */
export class PageResourceCollector {
  readonly #fetch: typeof fetch | undefined
  #seen = new Set<string>()
  #queue: { url: string; loadedAt: number }[] = []
  #reads: Read[] = []
  #inFlight = 0
  #enabled = false
  /** Keys of resources the run already stored, which no document reads again. */
  #stored = new Set<string>()
  #done: PageResource[] = []
  #reReads: ResourceReRead[] = []

  constructor(fetchImpl: typeof fetch | undefined) {
    this.#fetch = fetchImpl
  }

  /** Every load the document made; candidates are queued once each. */
  noteLoad(load: ObservedLoad): void {
    const url = resourceTimingUrl(load.name)
    if (
      !CANDIDATE_INITIATORS.has(load.initiatorType) ||
      this.#seen.has(url) ||
      NEVER_STORED.has(getRequestType(url)) ||
      isSkippedResourceHost(url) ||
      (load.decodedBodySize ?? 0) > PAGE_RESOURCE_LIMITS.maxResourceBytes
    ) {
      return
    }
    this.#seen.add(url)
    this.#queue.push({
      url,
      loadedAt: Math.round(timeOrigin() + load.startTime)
    })
    this.#pump()
  }

  /** Whether a Resource Timing entry is this collector's own read: the read of its URL started nearest it, within a few ms. */
  isOwnRead(name: string, startTime: number): boolean {
    const url = resourceTimingUrl(name)
    let match: Read | undefined
    let best = OWN_ENTRY_TOLERANCE_MS
    for (const read of this.#reads) {
      const delta = Math.abs(read.start - startTime)
      if (read.url === url && delta <= best) {
        match = read
        best = delta
      }
    }
    if (!match) {
      return false
    }
    this.#reads = this.#reads.filter((r) => r !== match)
    return true
  }

  /** Called by a drain; a drain that names no mode leaves reads unstarted and returns nothing. */
  drain(opts: TraceDrainOptions | undefined): PageResourceDrain | undefined {
    if (opts?.resources !== 'styles') {
      return undefined
    }
    this.#enabled = true
    for (const key of opts.stored ?? []) {
      this.#stored.add(key)
    }
    this.#pump()
    const pageResources: PageResource[] = []
    let bytes = 0
    while (this.#done.length > 0) {
      const next = this.#done[0]
      if (
        pageResources.length > 0 &&
        bytes + next.size > PAGE_RESOURCE_LIMITS.maxDrainBytes
      ) {
        break
      }
      bytes += next.size
      pageResources.push(this.#done.shift()!)
    }
    const resourceReReads = this.#reReads
    this.#reReads = []
    return {
      pageResources,
      resourceReReads,
      pendingResources: this.#queue.length + this.#inFlight + this.#done.length
    }
  }

  #pump(): void {
    if (!this.#enabled || !this.#fetch) {
      return
    }
    while (this.#inFlight < MAX_CONCURRENT_READS && this.#queue.length > 0) {
      const next = this.#queue.shift()!
      if (this.#stored.has(resourceUrlKey(next.url))) {
        continue
      }
      this.#inFlight++
      void this.#read(next.url, next.loadedAt).finally(() => {
        this.#inFlight--
        this.#pump()
      })
    }
  }

  async #read(url: string, loadedAt: number): Promise<void> {
    const start = performance.now()
    this.#reads.push({ url, start })
    this.#reReads.push({
      url,
      startedAt: Math.round(timeOrigin() + start),
      loadedAt
    })
    try {
      const response = await this.#fetch!(url, {
        cache: 'force-cache',
        ...(typeof AbortSignal?.timeout === 'function'
          ? { signal: AbortSignal.timeout(PAGE_RESOURCE_READ_TIMEOUT_MS) }
          : {})
      })
      const kind = response.ok
        ? pageResourceKind(url, response.headers.get('content-type'))
        : undefined
      if (kind) {
        const bytes = new Uint8Array(await response.arrayBuffer())
        this.#keep(url, kind, response.headers.get('content-type'), bytes)
        return
      }
    } catch (err) {
      log(`page resource ${url} could not be read back`, err)
    }
    this.#keepParsedStylesheet(url)
  }

  #keepParsedStylesheet(url: string): void {
    const text = isSameOrigin(url) ? parsedStylesheetText(url) : undefined
    if (text !== undefined) {
      this.#keep(url, 'stylesheet', 'text/css', new TextEncoder().encode(text))
    }
  }

  #keep(
    url: string,
    kind: PageResource['kind'],
    contentType: string | null,
    bytes: Uint8Array
  ): void {
    if (bytes.byteLength > PAGE_RESOURCE_LIMITS.maxResourceBytes) {
      return
    }
    this.#done.push({
      url,
      kind,
      mimeType: pageResourceMimeType(url, kind, contentType),
      data: toBase64(bytes),
      size: bytes.byteLength
    })
  }
}
