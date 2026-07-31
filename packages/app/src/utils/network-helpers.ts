import { isRequestType, type NetworkRequest } from '@wdio/devtools-shared'
import {
  RESOURCE_TYPE_BY_REQUEST_TYPE,
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
 * Bucket a request into the display type the list colours and filters by,
 * translating the type the capture side already classified it as. Header and
 * extension sniffing deliberately doesn't happen here — that is core's
 * `getRequestType`, and a second copy of it drifted from the first. The guard is
 * for wire data only: `RequestType` covers every word a current producer emits,
 * but an older trace file can still carry one it doesn't.
 */
export function getResourceType(request: NetworkRequest): ResourceType {
  const captured =
    typeof request.type === 'string' ? request.type.toLowerCase() : ''
  if (isRequestType(captured)) {
    return RESOURCE_TYPE_BY_REQUEST_TYPE[captured]
  }
  // An unrecognised type still tells us this much: a body-carrying method is a
  // data request, never a static resource.
  if (request.method !== 'GET') {
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
  if (!url || url === 'event') {
    return '-'
  }

  try {
    const urlObj = new URL(url)
    const pathname = urlObj.pathname
    const parts = pathname.split('/').filter(Boolean)
    const fileName = parts[parts.length - 1]

    // No named segment: the host identifies the row, plus a query-bearing path
    // that is nothing but separators.
    if (!fileName) {
      return urlObj.search && pathname.length > 1
        ? `${urlObj.hostname}${pathname}`
        : urlObj.hostname
    }

    return fileName
  } catch {
    // If URL parsing fails, return a cleaned version
    return url.slice(0, 50)
  }
}
