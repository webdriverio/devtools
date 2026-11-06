// The stylesheets and fonts a trace stores so its replay does not depend on the site under test.

/** `styles` stores stylesheets and fonts; `none` stores nothing and replays them from the live site. */
export type TraceResourcesMode = 'none' | 'styles'

export const DEFAULT_TRACE_RESOURCES: TraceResourcesMode = 'styles'

export type PageResourceKind = 'stylesheet' | 'font'

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/** One stored resource as the collector reads it and the player receives it. */
export interface PageResource {
  /** Absolute URL, without the fragment, as the page requested it. */
  url: string
  mimeType: string
  kind: PageResourceKind
  /** The body, base64. */
  data: string
  /** Decoded body length in bytes. */
  size: number
}

/** The collector's own read of a loaded resource, whose driver-side network row the trace writer drops. */
export interface ResourceReRead {
  url: string
  /** When the read started, page clock, epoch ms. */
  startedAt: number
  /** When the page's own load of it started, epoch ms; bounds how early a matching row may be. */
  loadedAt: number
}

/** A page resource as untrusted input from the page or the wire; malformed ones are dropped at the boundary. */
export function isPageResource(value: unknown): value is PageResource {
  const r = value as Partial<PageResource> | null
  return (
    typeof r === 'object' &&
    r !== null &&
    typeof r.url === 'string' &&
    typeof r.data === 'string' &&
    BASE64.test(r.data) &&
    typeof r.mimeType === 'string' &&
    typeof r.size === 'number' &&
    (r.kind === 'stylesheet' || r.kind === 'font')
  )
}

export function isResourceReRead(value: unknown): value is ResourceReRead {
  const r = value as Partial<ResourceReRead> | null
  return (
    typeof r === 'object' &&
    r !== null &&
    typeof r.url === 'string' &&
    Number.isFinite(r.startedAt) &&
    Number.isFinite(r.loadedAt)
  )
}

/** One line of the archive's page-resources index: where a URL's bytes sit in `resources/`. */
export interface PageResourceIndexEntry {
  url: string
  sha1: string
  mimeType: string
  kind: PageResourceKind
  size: number
}

/** Size held per resource (collector side) and per archive (writer side). */
export const PAGE_RESOURCE_LIMITS = {
  maxResourceBytes: 1024 * 1024,
  maxTraceBytes: 8 * 1024 * 1024,
  /** Decoded bytes one drain returns; the rest wait for the next drain. */
  maxDrainBytes: 4 * 1024 * 1024
} as const

/** Stored URLs a drain tells the page about, so a later document skips them; past this a resource is read again, harmlessly. */
export const MAX_STORED_RESOURCE_KEYS = 512

/** A compact key for a resource URL: 32-bit FNV-1a over its UTF-8 bytes, base 36. */
export function resourceUrlKey(url: string): string {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(url)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

/** How long an end-of-test drain waits for reads still in flight. */
export const PAGE_RESOURCE_SETTLE_TIMEOUT_MS = 2000
export const PAGE_RESOURCE_SETTLE_POLL_MS = 100

/** How long one read back may take before it counts as finished with nothing stored; under the settle budget, so a stalled read cannot hold every test end for the whole budget. */
export const PAGE_RESOURCE_READ_TIMEOUT_MS =
  PAGE_RESOURCE_SETTLE_TIMEOUT_MS - 2 * PAGE_RESOURCE_SETTLE_POLL_MS

/** Hosts whose resources are never stored: tracking and tag-manager assets carry no page styling worth replaying. */
export const PAGE_RESOURCE_SKIP_HOSTS: readonly string[] = [
  'google-analytics.com',
  'googletagmanager.com',
  'doubleclick.net',
  'googlesyndication.com',
  'facebook.net',
  'hotjar.com',
  'segment.com',
  'segment.io',
  'mixpanel.com',
  'amplitude.com',
  'fullstory.com',
  'clarity.ms',
  'newrelic.com',
  'nr-data.net',
  'optimizely.com',
  'intercom.io',
  'sentry.io'
]

/** Whether `url`'s host is, or is under, a skipped host. */
export function isSkippedResourceHost(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return true
  }
  return PAGE_RESOURCE_SKIP_HOSTS.some(
    (skip) => host === skip || host.endsWith(`.${skip}`)
  )
}

const FONT_EXTENSIONS = ['.woff2', '.woff', '.ttf', '.otf', '.eot']

/** Content types that say nothing about what the body is. */
const UNTYPED = new Set(['', 'application/octet-stream', 'binary/octet-stream'])

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase()
  } catch {
    return ''
  }
}

/** What a response is, by its content type, with the path deciding only for the untyped types servers give fonts. */
export function pageResourceKind(
  url: string,
  contentType: string | null | undefined
): PageResourceKind | undefined {
  const type = (contentType ?? '').toLowerCase().split(';')[0].trim()
  if (type === 'text/css') {
    return 'stylesheet'
  }
  if (
    type.startsWith('font/') ||
    type.startsWith('application/font-') ||
    type.startsWith('application/x-font-') ||
    type === 'application/vnd.ms-fontobject'
  ) {
    return 'font'
  }
  if (UNTYPED.has(type)) {
    const path = pathOf(url)
    if (FONT_EXTENSIONS.some((ext) => path.endsWith(ext))) {
      return 'font'
    }
    if (path.endsWith('.css')) {
      return 'stylesheet'
    }
  }
  return undefined
}

const FONT_TYPES: Record<string, string> = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject'
}

/** The MIME type a stored resource is served with: its response's, or one read off the path when that named none. */
export function pageResourceMimeType(
  url: string,
  kind: PageResourceKind,
  contentType: string | null | undefined
): string {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase()
  if (type && !UNTYPED.has(type)) {
    return type
  }
  if (kind === 'stylesheet') {
    return 'text/css'
  }
  const path = pathOf(url)
  const ext = FONT_EXTENSIONS.find((candidate) => path.endsWith(candidate))
  return ext ? FONT_TYPES[ext] : 'font/woff2'
}
