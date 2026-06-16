/**
 * Resource type patterns for network request classification
 */
export const RESOURCE_TYPE_PATTERNS = {
  HTML: {
    contentTypes: ['text/html'],
    extensions: ['.html', '.htm']
  },
  CSS: {
    contentTypes: ['text/css'],
    extensions: ['.css']
  },
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
  Fetch: {
    contentTypes: ['application/json'],
    extensions: []
  }
} as const

export const OTHER_RESOURCE_TYPE = 'Other'

export type ResourceType =
  | keyof typeof RESOURCE_TYPE_PATTERNS
  | typeof OTHER_RESOURCE_TYPE

export const TYPE_DOT_CLASS: Record<ResourceType, string> = {
  HTML: 'type-html',
  CSS: 'type-css',
  JS: 'type-js',
  Image: 'type-image',
  Font: 'type-font',
  Fetch: 'type-fetch',
  Other: 'type-other'
}

/**
 * Available resource types for filtering
 */
export const RESOURCE_TYPES = [
  'All',
  'Fetch',
  'HTML',
  'JS',
  'CSS',
  'Font',
  'Image'
] as const

/** Inclusive lower bounds of the HTTP status-code ranges. */
export const HTTP_STATUS = {
  SUCCESS_MIN: 200,
  REDIRECT_MIN: 300,
  CLIENT_ERROR_MIN: 400
} as const

/** Coarse status buckets used to colour the status dot/number in the list. */
export const STATUS_KIND = {
  OK: 'ok',
  REDIRECT: 'redirect',
  ERROR: 'error',
  PENDING: 'pending'
} as const

export type StatusKind = (typeof STATUS_KIND)[keyof typeof STATUS_KIND]
