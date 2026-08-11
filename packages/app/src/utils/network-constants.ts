import type { RequestType } from '@wdio/devtools-shared'

/**
 * The Network list's display buckets — one row colour each. `Other` is the
 * residual for a request whose captured type the panel doesn't recognise.
 */
/**
 * Content-type and extension patterns used to sniff a resource type when the
 * capture did not classify one. Needed because a reconstructed trace carries an
 * empty HAR `content.mimeType`, so every request arrives as `other` — without
 * this, every row in the Network tab renders the same neutral dot.
 */
export const RESOURCE_TYPE_PATTERNS = {
  HTML: { contentTypes: ['text/html'], extensions: ['.html', '.htm'] },
  CSS: { contentTypes: ['text/css'], extensions: ['.css'] },
  JS: {
    contentTypes: ['javascript', 'ecmascript'],
    extensions: ['.js', '.mjs']
  },
  Image: {
    contentTypes: ['image/'],
    extensions: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico']
  },
  Font: {
    contentTypes: ['font/', 'woff'],
    extensions: ['.woff', '.woff2', '.ttf', '.eot', '.otf']
  },
  Fetch: { contentTypes: ['application/json'], extensions: [] }
} as const

export const TYPE_DOT_CLASS = {
  HTML: 'type-html',
  CSS: 'type-css',
  JS: 'type-js',
  Image: 'type-image',
  Font: 'type-font',
  Fetch: 'type-fetch',
  Other: 'type-other'
} as const

export type ResourceType = keyof typeof TYPE_DOT_CLASS

export const OTHER_RESOURCE_TYPE: ResourceType = 'Other'

/**
 * The captured `NetworkRequest.type` vocabulary mapped onto the display
 * buckets. Classification happens once, on the capture side; this table only
 * translates its words, so the panel never re-derives a type from headers core
 * already read. Keyed by the full `RequestType` union so a new capture-side
 * category fails this file at compile time instead of falling silently into
 * `Other`. `fetch` and `xhr` share the Fetch bucket: both mean "data request",
 * a split the list has no separate colour or tab for.
 */
export const RESOURCE_TYPE_BY_REQUEST_TYPE: Readonly<
  Record<RequestType, ResourceType>
> = {
  document: 'HTML',
  stylesheet: 'CSS',
  script: 'JS',
  image: 'Image',
  font: 'Font',
  fetch: 'Fetch',
  xhr: 'Fetch',
  other: OTHER_RESOURCE_TYPE
}

/**
 * Filter tabs, in list order. Every entry but `All` is a bucket the table above
 * can produce — a tab naming an unproducible bucket could never match a row.
 */
export const RESOURCE_TYPES = [
  'All',
  'Fetch',
  'HTML',
  'JS',
  'CSS',
  'Font',
  'Image'
] as const satisfies readonly ('All' | ResourceType)[]

/** The active filter: a bucket, or `All` for no filtering. */
export type ResourceFilter = (typeof RESOURCE_TYPES)[number]

/** Inclusive lower bounds of the HTTP status-code ranges. */
export const HTTP_STATUS = {
  SUCCESS_MIN: 200,
  REDIRECT_MIN: 300,
  CLIENT_ERROR_MIN: 400
} as const

/** Shown in the list's status column and the detail card when a request failed
 *  at the transport level, so it carries no code — the capture reports status 0
 *  there, which would otherwise render as the same dash a request still in
 *  flight shows. */
export const FAILED_STATUS_LABEL = 'ERR'

/** Coarse status buckets used to colour the status dot/number in the list. */
export const STATUS_KIND = {
  OK: 'ok',
  REDIRECT: 'redirect',
  ERROR: 'error',
  PENDING: 'pending'
} as const

export type StatusKind = (typeof STATUS_KIND)[keyof typeof STATUS_KIND]
