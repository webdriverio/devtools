import { describe, it, expect } from 'vitest'
import { harToNetworkRequest } from '../src/trace-reader-utils.js'
import type { HarSnapshot } from '../src/trace-reader-types.js'

const STARTED = '2026-10-14T10:00:00.000Z'

/** What the writer emits for a page's Resource Timing entry: a status it had
 *  to write as 0, no headers, the measured phases, and the two markers. */
function resourceTimingSnapshot(
  overrides: Partial<HarSnapshot> = {}
): HarSnapshot {
  return {
    startedDateTime: STARTED,
    time: 40,
    request: { method: '', url: 'https://app.test/login', headers: [] },
    response: {
      status: 0,
      statusText: '',
      headers: [],
      content: { size: 1200, mimeType: '' }
    },
    timings: {
      blocked: 1,
      dns: 2,
      connect: 3,
      ssl: -1,
      send: 0,
      wait: 30,
      receive: 4
    },
    _resourceType: 'document',
    _source: 'resource-timing',
    ...overrides
  }
}

describe('harToNetworkRequest: a Resource Timing entry', () => {
  it('reads the written 0 as no status, not as a transport failure', () => {
    const request = harToNetworkRequest(resourceTimingSnapshot(), 0)
    expect(request.status).toBeUndefined()
    expect('status' in request).toBe(false)
    expect(request.statusText).toBeUndefined()
    expect(request.response).toBeUndefined()
    expect(request.source).toBe('resource-timing')
  })

  it('keeps a status Chromium did report', () => {
    const request = harToNetworkRequest(
      resourceTimingSnapshot({
        response: {
          status: 304,
          statusText: '',
          content: { size: 0, mimeType: '' }
        }
      }),
      0
    )
    expect(request.status).toBe(304)
  })

  it('takes its type from the capture, which an empty mime cannot name', () => {
    const request = harToNetworkRequest(resourceTimingSnapshot(), 0)
    expect(request.type).toBe('document')
    expect(request.method).toBe('')
  })

  it('restores the measured phases and drops the ones marked -1', () => {
    const request = harToNetworkRequest(resourceTimingSnapshot(), 0)
    expect(request.timings).toEqual({
      blocked: 1,
      dns: 2,
      connect: 3,
      send: 0,
      wait: 30,
      receive: 4
    })
  })

  it('carries a size only when one was captured', () => {
    expect(harToNetworkRequest(resourceTimingSnapshot(), 0).size).toBe(1200)
    expect(
      harToNetworkRequest(
        resourceTimingSnapshot({
          response: {
            status: 0,
            statusText: '',
            content: { size: 0, mimeType: '' }
          }
        }),
        0
      ).size
    ).toBeUndefined()
  })
})

describe('harToNetworkRequest: every other entry', () => {
  const driverSeen: HarSnapshot = {
    startedDateTime: STARTED,
    time: 20,
    request: { method: 'GET', url: 'https://app.test/app.js', headers: [] },
    response: {
      status: 200,
      statusText: 'OK',
      headers: [{ name: 'content-type', value: 'text/javascript' }],
      content: { size: 900, mimeType: 'text/javascript' }
    },
    timings: { send: 0, wait: 20, receive: 0 }
  }

  it('prefers the written type over the mime it would otherwise sniff', () => {
    expect(
      harToNetworkRequest({ ...driverSeen, _resourceType: 'fetch' }, 0).type
    ).toBe('fetch')
  })

  it('still sniffs the mime for a zip written before the type was stated', () => {
    expect(harToNetworkRequest(driverSeen, 0).type).toBe('script')
  })

  it('does not restore the writer’s one-phase fallback as a measurement', () => {
    const request = harToNetworkRequest(driverSeen, 0)
    expect(request.timings).toBeUndefined()
    expect(request.status).toBe(200)
    expect(request.response?.status).toBe(200)
  })
})
