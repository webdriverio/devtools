import {
  RESOURCE_TYPE_PATTERNS,
  OTHER_RESOURCE_TYPE,
  HTTP_STATUS,
  STATUS_KIND,
  type StatusKind,
  type ResourceType
} from './network-constants.js'

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
 * Bucket an HTTP status into a coarse {@link StatusKind}. The single source of
 * truth for status ranges — both the dot colour and the text colour derive
 * from it.
 */
export function statusKind(status?: number, hasError?: boolean): StatusKind {
  if (hasError) {
    return STATUS_KIND.ERROR
  }
  if (typeof status !== 'number') {
    return STATUS_KIND.PENDING
  }
  if (status >= HTTP_STATUS.SUCCESS_MIN && status < HTTP_STATUS.REDIRECT_MIN) {
    return STATUS_KIND.OK
  }
  if (
    status >= HTTP_STATUS.REDIRECT_MIN &&
    status < HTTP_STATUS.CLIENT_ERROR_MIN
  ) {
    return STATUS_KIND.REDIRECT
  }
  if (status >= HTTP_STATUS.CLIENT_ERROR_MIN) {
    return STATUS_KIND.ERROR
  }
  return STATUS_KIND.PENDING
}

const STATUS_TEXT_CLASS: Record<StatusKind, string> = {
  [STATUS_KIND.OK]: 'text-green-500',
  [STATUS_KIND.REDIRECT]: 'text-yellow-500',
  [STATUS_KIND.ERROR]: 'text-red-500',
  [STATUS_KIND.PENDING]: 'text-gray-500'
}

/**
 * Tailwind text-colour class for an HTTP status code — derived from
 * {@link statusKind} so the thresholds live in one place.
 */
export function getStatusClass(status?: number): string {
  return STATUS_TEXT_CLASS[statusKind(status)]
}

/**
 * Determine resource type from network request
 */
export function getResourceType(request: NetworkRequest): ResourceType {
  const url = request.url.toLowerCase()
  const contentType =
    request.responseHeaders?.['content-type']?.toLowerCase() || ''
  const entries = Object.entries(RESOURCE_TYPE_PATTERNS) as [
    keyof typeof RESOURCE_TYPE_PATTERNS,
    (typeof RESOURCE_TYPE_PATTERNS)[keyof typeof RESOURCE_TYPE_PATTERNS]
  ][]

  // Check by content-type first
  for (const [type, patterns] of entries) {
    if (patterns.contentTypes.some((ct) => contentType.includes(ct))) {
      return type
    }
  }

  // Fallback to URL extension
  for (const [type, patterns] of entries) {
    if (patterns.extensions.some((ext) => url.endsWith(ext))) {
      return type
    }
  }

  // Check by request type
  if (request.type === 'fetch' || request.method !== 'GET') {
    return 'Fetch'
  }

  return OTHER_RESOURCE_TYPE
}

/** Short content-type label for a request (response content-type, then the
 *  captured `type`, else a dash placeholder). */
export function contentType(request: NetworkRequest): string {
  return (
    request.responseHeaders?.['content-type']?.split(';')[0] ||
    request.type ||
    '-'
  )
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
