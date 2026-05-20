import { describe, it, expect } from 'vitest'
import { NetworkTracer } from '../src/network.js'

describe('NetworkTracer', () => {
  it('returns empty entries initially', () => {
    const tracer = new NetworkTracer(() => 0)
    expect(tracer.entries).toEqual([])
  })

  it('records a request-response pair as resource-snapshot', () => {
    let monotonic = 0
    const tracer = new NetworkTracer(() => monotonic)

    tracer.handleRequestStarted({
      request: {
        request: 'req-1',
        url: 'https://example.com',
        method: 'GET',
        headers: []
      },
      context: 'ctx-1',
      timestamp: Date.now()
    })

    monotonic = 150
    tracer.handleResponseCompleted({
      request: { request: 'req-1' },
      response: {
        status: 200,
        statusText: 'OK',
        headers: [{ name: 'content-type', value: 'text/html' }],
        bytesReceived: 1024
      }
    })

    expect(tracer.entries).toHaveLength(1)
    const entry = tracer.entries[0]
    expect(entry.type).toBe('resource-snapshot')
    expect(entry.snapshot.request.url).toBe('https://example.com')
    expect(entry.snapshot.response.status).toBe(200)
    expect(entry.snapshot._monotonicTime).toBe(0)
    expect(entry.snapshot._frameref).toBe('ctx-1')
  })

  it('filters responses with empty content-type', () => {
    const tracer = new NetworkTracer(() => 0)

    tracer.handleRequestStarted({
      request: {
        request: 'req-2',
        url: 'https://example.com/img',
        method: 'GET'
      },
      timestamp: Date.now()
    })

    tracer.handleResponseCompleted({
      request: { request: 'req-2' },
      response: { status: 200, statusText: 'OK', headers: [] }
    })

    expect(tracer.entries).toHaveLength(0)
  })

  it('removes pending request on fetch error', () => {
    const tracer = new NetworkTracer(() => 0)

    tracer.handleRequestStarted({
      request: { request: 'req-3', url: 'https://fail.com', method: 'GET' },
      timestamp: Date.now()
    })

    tracer.handleFetchError({ request: { request: 'req-3' } })

    tracer.handleResponseCompleted({
      request: { request: 'req-3' },
      response: {
        status: 200,
        headers: [{ name: 'content-type', value: 'text/html' }]
      }
    })

    expect(tracer.entries).toHaveLength(0)
  })
})
