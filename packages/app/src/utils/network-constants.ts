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
