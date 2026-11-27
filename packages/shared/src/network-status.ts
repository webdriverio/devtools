import {
  NETWORK_CAPTURE_SOURCE,
  type NetworkCaptureSource,
  type NetworkRequest
} from './types.js'

const HTTP_STATUS = {
  SUCCESS_MIN: 200,
  REDIRECT_MIN: 300,
  CLIENT_ERROR_MIN: 400
} as const

/** How a request ended: `unknown` completed on a source that exposes no status (Resource Timing outside Chromium), `pending` is still in flight. */
export const STATUS_KIND = {
  OK: 'ok',
  REDIRECT: 'redirect',
  ERROR: 'error',
  PENDING: 'pending',
  UNKNOWN: 'unknown'
} as const

export type StatusKind = (typeof STATUS_KIND)[keyof typeof STATUS_KIND]

// Status 0 is what the capture records for a transport failure, and what a trace writes for a request that had not answered yet.
const NO_RESPONSE_STATUS = 0

/** The single source of truth for status ranges; a missing status is pending, unless the source never exposes one. */
export function statusKind(
  status?: number,
  hasError?: boolean,
  source?: NetworkCaptureSource
): StatusKind {
  if (hasError) {
    return STATUS_KIND.ERROR
  }
  if (typeof status !== 'number') {
    return source === NETWORK_CAPTURE_SOURCE.RESOURCE_TIMING
      ? STATUS_KIND.UNKNOWN
      : STATUS_KIND.PENDING
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

/** Whether a request failed without an HTTP error code: a producer-reported error, or status 0. */
export function isTransportFailure(
  req: Pick<NetworkRequest, 'error' | 'status'>
): boolean {
  return Boolean(req.error) || req.status === NO_RESPONSE_STATUS
}

/** The status bucket a request is judged by, wherever it is shown. */
export function requestStatusKind(
  req: Pick<NetworkRequest, 'error' | 'status' | 'source'>
): StatusKind {
  return statusKind(req.status, isTransportFailure(req), req.source)
}

/** Whether a request failed: status 0, an error status or a producer-reported error; a request with no status never has. */
export function isFailedRequest(
  req: Pick<NetworkRequest, 'error' | 'status' | 'source'>
): boolean {
  return requestStatusKind(req) === STATUS_KIND.ERROR
}

/** What a Resource Timing capture could not see, so a missing status or header reads as the browser's limit; undefined for any other source. */
export function resourceTimingNote(
  req: Pick<NetworkRequest, 'source' | 'status'>
): string | undefined {
  if (req.source !== NETWORK_CAPTURE_SOURCE.RESOURCE_TIMING) {
    return undefined
  }
  return req.status
    ? 'Resource Timing: this browser exposes no headers or body for the request'
    : 'Resource Timing: this browser exposes no status, headers or body for the request'
}
