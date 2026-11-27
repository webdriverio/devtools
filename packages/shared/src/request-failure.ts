import type { NetworkRequest } from './types.js'

const TRANSPORT_FAILURE_STATUS = 0
const FIRST_ERROR_STATUS = 400

/** A transport failure, which the capture side records as status 0, or a response with an error status. A request with no status is unknown, not failed. */
export function isFailedRequest(request: NetworkRequest): boolean {
  return (
    request.status !== undefined &&
    (request.status === TRANSPORT_FAILURE_STATUS ||
      request.status >= FIRST_ERROR_STATUS)
  )
}
