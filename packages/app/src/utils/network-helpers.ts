import { RESOURCE_TYPE_PATTERNS } from './network-constants.js'

/**
 * Format bytes to human-readable format
 */
export function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) {
    return '-'
  }
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const size = bytes / Math.pow(k, i)
  return size >= 10
    ? `${size.toFixed(0)}${sizes[i]}`
    : `${size.toFixed(1)}${sizes[i]}`
}

/**
 * Format milliseconds to human-readable format
 */
export function formatTime(ms?: number): string {
  if (ms === undefined || ms === null) {
    return '-'
  }
  if (ms < 1) {
    return `${ms.toFixed(2)}ms`
  }
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`
  }
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Get CSS class based on HTTP status code
 */
export function getStatusClass(status?: number): string {
  if (!status) {
    return 'text-gray-500'
  }
  if (status >= 200 && status < 300) {
    return 'text-green-500'
  }
  if (status >= 300 && status < 400) {
    return 'text-yellow-500'
  }
  if (status >= 400) {
    return 'text-red-500'
  }
  return 'text-gray-500'
}

/**
 * Determine resource type from network request
 */
export function getResourceType(request: NetworkRequest): string {
  const url = request.url.toLowerCase()
  const contentType =
    request.responseHeaders?.['content-type']?.toLowerCase() || ''

  // Check by content-type first
  for (const [type, patterns] of Object.entries(RESOURCE_TYPE_PATTERNS)) {
    if (patterns.contentTypes.some((ct) => contentType.includes(ct))) {
      return type
    }
  }

  // Fallback to URL extension
  for (const [type, patterns] of Object.entries(RESOURCE_TYPE_PATTERNS)) {
    if (patterns.extensions.some((ext) => url.endsWith(ext))) {
      return type
    }
  }

  // Check by request type
  if (request.type === 'fetch' || request.method !== 'GET') {
    return 'Fetch'
  }

  return 'Other'
}

/**
 * Extract filename from URL
 */
export function getFileName(url: string): string {
  if (!url || url === '' || url === 'event') {
    return '-'
  }

  try {
    const urlObj = new URL(url)
    const pathname = urlObj.pathname
    const parts = pathname.split('/').filter(Boolean)
    const fileName = parts[parts.length - 1]

    // If there's a query string and no filename, show the host + path
    if (!fileName || fileName === '' || pathname === '/') {
      if (urlObj.search) {
        return `${urlObj.hostname}${pathname.length > 1 ? pathname : ''}`
      }
      return urlObj.hostname
    }

    return fileName
  } catch {
    // If URL parsing fails, return a cleaned version
    return url.slice(0, 50)
  }
}
