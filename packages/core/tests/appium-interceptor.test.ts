import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/webdriver-http.js', () => ({ webdriverExecute: vi.fn() }))

import { webdriverExecute } from '../src/webdriver-http.js'
import {
  InterceptorNetworkPoller,
  flattenInterceptedHeaders,
  interceptedBodyText,
  interceptedToNetworkRequest,
  type InterceptedRequest
} from '../src/appium-interceptor.js'

const execute = vi.mocked(webdriverExecute)
const ADDRESS = { hostname: '127.0.0.1', port: 4723 }

const entry = (over: Partial<InterceptedRequest> = {}): InterceptedRequest => ({
  url: 'https://api.example.com/items',
  method: 'GET',
  statusCode: 200,
  responseHeaders: { 'content-type': 'application/json; charset=utf-8' },
  responseBody: { ok: true },
  ...over
})

describe('flattenInterceptedHeaders', () => {
  it('joins repeated headers and drops the status line the plugin files as a header', () => {
    expect(
      flattenInterceptedHeaders({
        'http/1.1 201 created': '',
        'set-cookie': ['a=1', 'b=2'],
        'content-type': 'text/plain'
      })
    ).toEqual({ 'set-cookie': 'a=1, b=2', 'content-type': 'text/plain' })
  })

  it('returns an empty map for absent headers', () => {
    expect(flattenInterceptedHeaders(undefined)).toEqual({})
  })
})

describe('interceptedBodyText', () => {
  it('keeps a string, serializes a parsed body, and reads empty as absent', () => {
    expect(interceptedBodyText('raw')).toBe('raw')
    expect(interceptedBodyText({ a: 1 })).toBe('{"a":1}')
    expect(interceptedBodyText('')).toBeUndefined()
    expect(interceptedBodyText(null)).toBeUndefined()
    expect(interceptedBodyText(undefined)).toBeUndefined()
  })
})

describe('interceptedToNetworkRequest', () => {
  it('maps an entry onto a network row stamped when it was observed', () => {
    const row = interceptedToNetworkRequest(
      entry({ requestHeaders: { accept: '*/*' }, requestBody: 'q=1' }),
      'interceptor-1-0',
      { timestamp: 1000, startTime: 50 }
    )
    expect(row).toMatchObject({
      id: 'interceptor-1-0',
      url: 'https://api.example.com/items',
      method: 'GET',
      status: 200,
      type: 'fetch',
      timestamp: 1000,
      startTime: 50,
      endTime: 50,
      requestHeaders: { accept: '*/*' },
      requestBody: 'q=1',
      responseBody: '{"ok":true}',
      size: 11,
      response: {
        fromCache: false,
        mimeType: 'application/json',
        status: 200
      }
    })
  })

  it('measures size in bytes, not characters', () => {
    const row = interceptedToNetworkRequest(
      entry({ responseBody: 'é' }),
      'id',
      { timestamp: 0, startTime: 0 }
    )
    expect(row.size).toBe(2)
  })

  it('leaves mime type and size empty when the response carries neither', () => {
    const row = interceptedToNetworkRequest(
      entry({ responseHeaders: undefined, responseBody: undefined }),
      'id',
      { timestamp: 0, startTime: 0 }
    )
    expect(row.response?.mimeType).toBe('')
    expect(row.size).toBeUndefined()
  })
})

describe('InterceptorNetworkPoller', () => {
  beforeEach(() => {
    execute.mockReset()
  })

  it('starts a listener and reads only the entries it has not listed yet', async () => {
    const poller = new InterceptorNetworkPoller(ADDRESS, 'sess')
    execute.mockResolvedValueOnce('L1')
    expect(await poller.start()).toBe(true)
    expect(execute).toHaveBeenLastCalledWith(
      ADDRESS,
      'sess',
      'interceptor: startListening',
      [{}]
    )

    execute.mockResolvedValueOnce([entry()])
    const first = await poller.drain()
    expect(first.map((r) => r.id)).toEqual(['interceptor-L1-0'])
    expect(execute).toHaveBeenLastCalledWith(
      ADDRESS,
      'sess',
      'interceptor: getInterceptedData',
      [{ id: 'L1' }]
    )

    execute.mockResolvedValueOnce([entry(), entry({ method: 'POST' })])
    const second = await poller.drain()
    expect(second.map((r) => [r.id, r.method])).toEqual([
      ['interceptor-L1-1', 'POST']
    ])

    execute.mockResolvedValueOnce([entry(), entry({ method: 'POST' })])
    expect(await poller.drain()).toEqual([])
  })

  it('does not list an entry twice when drains overlap', async () => {
    const poller = new InterceptorNetworkPoller(ADDRESS, 'sess')
    execute.mockResolvedValueOnce('L1')
    await poller.start()
    execute.mockResolvedValue([entry()])
    const [a, b] = await Promise.all([poller.drain(), poller.drain()])
    expect([...a, ...b]).toHaveLength(1)
  })

  it('reports a failed start and then reads nothing', async () => {
    const poller = new InterceptorNetworkPoller(ADDRESS, 'sess')
    execute.mockResolvedValueOnce(null)
    expect(await poller.start()).toBe(false)
    expect(await poller.drain()).toEqual([])
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('reads nothing from a failed or malformed read and keeps its position', async () => {
    const poller = new InterceptorNetworkPoller(ADDRESS, 'sess')
    execute.mockResolvedValueOnce('L1')
    await poller.start()
    execute.mockResolvedValueOnce(null)
    expect(await poller.drain()).toEqual([])
    execute.mockResolvedValueOnce({ error: 'x' })
    expect(await poller.drain()).toEqual([])
    execute.mockResolvedValueOnce([entry()])
    expect((await poller.drain()).map((r) => r.id)).toEqual([
      'interceptor-L1-0'
    ])
  })
})
