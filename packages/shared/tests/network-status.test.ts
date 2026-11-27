import { describe, expect, it } from 'vitest'
import {
  isFailedRequest,
  isTransportFailure,
  requestStatusKind,
  resourceTimingNote,
  statusKind,
  STATUS_KIND
} from '../src/network-status.js'
import { NETWORK_CAPTURE_SOURCE, type NetworkRequest } from '../src/types.js'

describe('statusKind', () => {
  it('buckets 2xx as ok', () => {
    expect(statusKind(200)).toBe(STATUS_KIND.OK)
    expect(statusKind(204)).toBe(STATUS_KIND.OK)
  })

  it('buckets 3xx as redirect', () => {
    expect(statusKind(301)).toBe(STATUS_KIND.REDIRECT)
    expect(statusKind(304)).toBe(STATUS_KIND.REDIRECT)
  })

  it('buckets 4xx/5xx as error', () => {
    expect(statusKind(404)).toBe(STATUS_KIND.ERROR)
    expect(statusKind(500)).toBe(STATUS_KIND.ERROR)
  })

  it('treats a missing status as pending', () => {
    expect(statusKind(undefined)).toBe(STATUS_KIND.PENDING)
  })

  it('treats a missing status from a source that never exposes one as unknown', () => {
    // A Resource Timing row completed; outside Chromium the browser simply
    // reports no status, which is not the same as one still on its way.
    expect(
      statusKind(undefined, false, NETWORK_CAPTURE_SOURCE.RESOURCE_TIMING)
    ).toBe(STATUS_KIND.UNKNOWN)
    expect(statusKind(200, false, NETWORK_CAPTURE_SOURCE.RESOURCE_TIMING)).toBe(
      STATUS_KIND.OK
    )
  })

  it('treats an error flag as error regardless of status', () => {
    expect(statusKind(200, true)).toBe(STATUS_KIND.ERROR)
    expect(statusKind(undefined, true)).toBe(STATUS_KIND.ERROR)
  })
})

describe('requestStatusKind', () => {
  it('reads a transport failure, status 0, as error', () => {
    expect(isTransportFailure({ status: 0 })).toBe(true)
    expect(requestStatusKind({ status: 0 })).toBe(STATUS_KIND.ERROR)
  })

  it('reads a producer-reported error as error before any status', () => {
    expect(requestStatusKind({ error: 'net::ERR_FAILED' })).toBe(
      STATUS_KIND.ERROR
    )
  })

  it('reads a Resource Timing row without a status as unknown, never failed', () => {
    const row: Pick<NetworkRequest, 'source' | 'status'> = {
      source: NETWORK_CAPTURE_SOURCE.RESOURCE_TIMING
    }
    expect(isTransportFailure(row)).toBe(false)
    expect(requestStatusKind(row)).toBe(STATUS_KIND.UNKNOWN)
  })
})

describe('resourceTimingNote', () => {
  it('names what a Resource Timing row could not see, status included when absent', () => {
    const source = NETWORK_CAPTURE_SOURCE.RESOURCE_TIMING
    expect(resourceTimingNote({ source })).toBe(
      'Resource Timing: this browser exposes no status, headers or body for the request'
    )
    expect(resourceTimingNote({ source, status: 200 })).toBe(
      'Resource Timing: this browser exposes no headers or body for the request'
    )
  })

  it('says nothing for a driver-side row', () => {
    expect(resourceTimingNote({ status: 200 })).toBeUndefined()
  })
})

describe('isFailedRequest', () => {
  it.each([0, 400, 404, 500])('reads status %s as failed', (status) => {
    expect(isFailedRequest({ status })).toBe(true)
  })

  it.each([200, 204, 304, 399])('reads status %s as not failed', (status) => {
    expect(isFailedRequest({ status })).toBe(false)
  })

  it('reads a request with no status as pending or unknown, never failed', () => {
    expect(isFailedRequest({})).toBe(false)
    expect(
      isFailedRequest({ source: NETWORK_CAPTURE_SOURCE.RESOURCE_TIMING })
    ).toBe(false)
  })

  it('reads a producer-reported error as failed whatever the status', () => {
    expect(isFailedRequest({ status: 200, error: 'net::ERR_ABORTED' })).toBe(
      true
    )
  })
})
