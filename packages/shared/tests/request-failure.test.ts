import { describe, expect, it } from 'vitest'
import { isFailedRequest } from '../src/request-failure.js'
import type { NetworkRequest } from '../src/types.js'

const request = (status?: number): NetworkRequest => ({
  id: '1',
  url: 'http://127.0.0.1/a',
  method: 'GET',
  type: 'fetch',
  timestamp: 0,
  startTime: 0,
  ...(status === undefined ? {} : { status })
})

describe('isFailedRequest', () => {
  it.each([0, 400, 404, 500])('reads status %s as failed', (status) => {
    expect(isFailedRequest(request(status))).toBe(true)
  })

  it.each([200, 204, 304, 399])('reads status %s as not failed', (status) => {
    expect(isFailedRequest(request(status))).toBe(false)
  })

  it('reads a request with no status as unknown rather than failed', () => {
    expect(isFailedRequest(request())).toBe(false)
  })
})
