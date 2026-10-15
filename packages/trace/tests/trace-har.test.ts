import { describe, it, expect } from 'vitest'
import {
  NETWORK_CAPTURE_SOURCE,
  type NetworkRequest
} from '@wdio/devtools-shared'
import { networkRequestToHar } from '../src/trace-har.js'

function entry(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'r1',
    url: 'https://app.test/api/items?page=2',
    method: 'GET',
    status: 200,
    statusText: 'OK',
    timestamp: 1_700_000_000_000,
    startTime: 10,
    endTime: 60,
    time: 50,
    type: 'fetch',
    responseHeaders: { 'content-type': 'application/json' },
    size: 7,
    ...overrides
  }
}

describe('networkRequestToHar: what every entry carries', () => {
  it('states the capture-side type, which a mime-less entry cannot restore', () => {
    const { snapshot } = networkRequestToHar(entry({ type: 'script' }))
    expect(snapshot._resourceType).toBe('script')
    expect(snapshot._source).toBeUndefined()
  })

  it('reports an unmeasured entry as one wait phase', () => {
    const { snapshot } = networkRequestToHar(entry())
    expect(snapshot.timings).toEqual({ send: 0, wait: 50, receive: 0 })
  })
})

describe('networkRequestToHar: a Resource Timing entry', () => {
  const fromResourceTiming = entry({
    status: undefined,
    statusText: undefined,
    responseHeaders: undefined,
    method: '',
    type: 'document',
    timings: { blocked: 1, dns: 2, connect: 3, send: 0, wait: 40, receive: 4 },
    source: NETWORK_CAPTURE_SOURCE.RESOURCE_TIMING
  })

  it('marks its source so the reader can tell a missing status from a failure', () => {
    const { snapshot } = networkRequestToHar(fromResourceTiming)
    expect(snapshot._source).toBe('resource-timing')
    expect(snapshot._resourceType).toBe('document')
    // HAR requires a numeric status; 0 is the only honest one here.
    expect(snapshot.response.status).toBe(0)
    expect(snapshot.response.headers).toEqual([])
    expect(snapshot.request.method).toBe('')
  })

  it('carries the measured phases, with HAR’s -1 for one it did not see', () => {
    const { snapshot } = networkRequestToHar(fromResourceTiming)
    expect(snapshot.timings).toEqual({
      blocked: 1,
      dns: 2,
      connect: 3,
      ssl: -1,
      send: 0,
      wait: 40,
      receive: 4
    })
  })
})
