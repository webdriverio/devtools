import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SessionCapturer } from '../src/session.js'

describe('SessionCapturer - Network Request Capture', () => {
  let capturer: SessionCapturer

  // Helper to create request event
  const createRequestEvent = (id: string, url: string, method = 'GET') => ({
    request: {
      request: id,
      url,
      method,
      headers: [],
      timings: { timeOrigin: 1000 }
    }
  })

  // Helper to create response event
  const createResponseEvent = (
    id: string,
    url: string,
    options: {
      status?: number
      statusText?: string
      contentType?: string
      size?: number
      timeOrigin?: number
    } = {}
  ) => {
    const headers = options.contentType
      ? [
          {
            name: 'Content-Type',
            value: { type: 'string', value: options.contentType }
          }
        ]
      : []

    return {
      request: { request: id },
      response: {
        url,
        status: options.status ?? 200,
        statusText: options.statusText ?? 'OK',
        headers,
        fromCache: false,
        bytesReceived: options.size ?? 1024,
        timings: { timeOrigin: options.timeOrigin ?? 1500 }
      }
    }
  }

  // Helper to verify request properties
  const verifyRequest = (
    req: any,
    expected: {
      url: string
      method?: string
      status?: number
      contentType?: string
      size?: number
    }
  ) => {
    expect(req).toBeDefined()
    expect(req.url).toBe(expected.url)
    expect(req.method).toBe(expected.method ?? 'GET')
    expect(req.status).toBe(expected.status ?? 200)
    expect(req.statusText).toBe('OK')
    if (expected.contentType) {
      expect(req.responseHeaders).toBeDefined()
      expect(req.responseHeaders?.['content-type']).toBe(expected.contentType)
    }
    if (expected.size) {
      expect(req.size).toBe(expected.size)
    }
    expect(req.time).toBeDefined()
    expect(typeof req.time).toBe('number')
    expect(req.time).toBeGreaterThanOrEqual(0)
  }

  beforeEach(() => {
    capturer = new SessionCapturer()
  })

  afterEach(() => {
    capturer.networkRequests = []
  })

  it('should capture, merge, and filter network requests correctly', () => {
    // Test 1: Successful request capture and merge
    const req1 = createRequestEvent('1', 'https://api.example.com/users')
    capturer.handleNetworkRequestStarted(req1 as any)

    const res1 = createResponseEvent('1', 'https://api.example.com/users', {
      contentType: 'application/json',
      size: 1024
    })
    capturer.handleNetworkResponseCompleted(res1 as any)

    expect(capturer.networkRequests).toHaveLength(1)
    verifyRequest(capturer.networkRequests[0], {
      url: 'https://api.example.com/users',
      method: 'GET',
      status: 200,
      contentType: 'application/json',
      size: 1024
    })

    // Test 2: Request without content-type should be filtered
    const req2 = createRequestEvent('2', 'https://api.example.com/no-type')
    capturer.handleNetworkRequestStarted(req2 as any)

    const res2 = createResponseEvent('2', 'https://api.example.com/no-type', {})
    capturer.handleNetworkResponseCompleted(res2 as any)

    // Should still have only 1 request (the first one)
    expect(capturer.networkRequests).toHaveLength(1)
  })

  it('should handle multiple concurrent requests', () => {
    const endpoints = ['endpoint1', 'endpoint2', 'endpoint3']

    // Start all requests
    endpoints.forEach((endpoint, i) => {
      const req = createRequestEvent(
        String(i + 1),
        `https://api.example.com/${endpoint}`
      )
      capturer.handleNetworkRequestStarted(req as any)
    })

    // Complete all requests
    endpoints.forEach((endpoint, i) => {
      const res = createResponseEvent(
        String(i + 1),
        `https://api.example.com/${endpoint}`,
        { contentType: 'application/json', size: 1024 }
      )
      capturer.handleNetworkResponseCompleted(res as any)
    })

    expect(capturer.networkRequests).toHaveLength(3)

    // Verify all URLs
    const urls = capturer.networkRequests.map((r) => r.url)
    expect(urls).toEqual([
      'https://api.example.com/endpoint1',
      'https://api.example.com/endpoint2',
      'https://api.example.com/endpoint3'
    ])

    // Verify each request
    capturer.networkRequests.forEach((req, index) => {
      verifyRequest(req, {
        url: `https://api.example.com/endpoint${index + 1}`,
        method: 'GET',
        status: 200,
        contentType: 'application/json',
        size: 1024
      })
    })
  })
})
