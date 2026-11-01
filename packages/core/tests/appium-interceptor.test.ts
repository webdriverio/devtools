import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  InterceptorNetworkPoller,
  NATIVE_NETWORK_DRAIN_INTERVAL_MS,
  NativeNetworkCapture,
  requestsInterceptedNetwork,
  flattenInterceptedHeaders,
  interceptedBodyText,
  interceptedToNetworkRequest,
  type InterceptedRequest
} from '../src/appium-interceptor.js'

const execute = vi.fn<(script: string, args: unknown[]) => Promise<unknown>>()

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

  it('lowercases names, so a mixed-case Content-Type is found', () => {
    expect(
      flattenInterceptedHeaders({ 'Content-Type': 'application/json' })
    ).toEqual({ 'content-type': 'application/json' })
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
    const poller = new InterceptorNetworkPoller(execute)
    execute.mockResolvedValueOnce('L1')
    expect(await poller.start()).toBe(true)
    expect(execute).toHaveBeenLastCalledWith('interceptor: startListening', [
      {}
    ])

    execute.mockResolvedValueOnce([entry()])
    const first = await poller.drain()
    expect(first.map((r) => r.id)).toEqual(['interceptor-L1-0'])
    expect(execute).toHaveBeenLastCalledWith(
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
    const poller = new InterceptorNetworkPoller(execute)
    execute.mockResolvedValueOnce('L1')
    await poller.start()
    execute.mockResolvedValue([entry()])
    const [a, b] = await Promise.all([poller.drain(), poller.drain()])
    expect([...a, ...b]).toHaveLength(1)
  })

  it('reports a failed start and then reads nothing', async () => {
    const poller = new InterceptorNetworkPoller(execute)
    execute.mockResolvedValueOnce(null)
    expect(await poller.start()).toBe(false)
    expect(await poller.drain()).toEqual([])
    expect(execute).toHaveBeenCalledTimes(1)
  })

  // A transport that resolves null on failure must surface as a failed read, not as "nothing new".
  it('rejects a failed or malformed read and keeps its position', async () => {
    const poller = new InterceptorNetworkPoller(execute)
    execute.mockResolvedValueOnce('L1')
    await poller.start()
    execute.mockResolvedValueOnce(null)
    await expect(poller.drain()).rejects.toThrow('no intercepted data')
    execute.mockResolvedValueOnce({ error: 'x' })
    await expect(poller.drain()).rejects.toThrow('no intercepted data')
    execute.mockResolvedValueOnce([entry()])
    expect((await poller.drain()).map((r) => r.id)).toEqual([
      'interceptor-L1-0'
    ])
  })
})

describe('InterceptorNetworkPoller after a failed read', () => {
  it('reports the failure to that drain and still reads on the next one', async () => {
    const poller = new InterceptorNetworkPoller(execute)
    execute.mockReset()
    execute.mockResolvedValueOnce('L1')
    await poller.start()
    execute.mockRejectedValueOnce(new Error('socket hang up'))
    await expect(poller.drain()).rejects.toThrow('socket hang up')
    execute.mockResolvedValueOnce([entry()])
    expect((await poller.drain()).map((r) => r.id)).toEqual([
      'interceptor-L1-0'
    ])
  })
})

describe('requestsInterceptedNetwork', () => {
  it('reads flat, W3C-wrapped and map-style capabilities', () => {
    expect(requestsInterceptedNetwork({ 'appium:intercept': true })).toBe(true)
    expect(
      requestsInterceptedNetwork({ alwaysMatch: { 'appium:intercept': true } })
    ).toBe(true)
    expect(
      requestsInterceptedNetwork({
        firstMatch: [{}, { 'appium:intercept': true }]
      })
    ).toBe(true)
    const map = new Map<string, unknown>([['appium:intercept', true]])
    expect(requestsInterceptedNetwork(map)).toBe(true)
  })

  // Appium merges `appium:options` into the session, so the plugin starts its proxy for these too.
  it('reads intercept grouped under appium:options, at every level', () => {
    const grouped = { 'appium:options': { intercept: true } }
    expect(requestsInterceptedNetwork(grouped)).toBe(true)
    expect(requestsInterceptedNetwork({ alwaysMatch: grouped })).toBe(true)
    expect(requestsInterceptedNetwork({ firstMatch: [{}, grouped] })).toBe(true)
    expect(
      requestsInterceptedNetwork(
        new Map<string, unknown>([['appium:options', { intercept: true }]])
      )
    ).toBe(true)
    expect(
      requestsInterceptedNetwork({ 'appium:options': { intercept: 'yes' } })
    ).toBe(false)
  })

  it('needs the literal true', () => {
    expect(requestsInterceptedNetwork({ 'appium:intercept': 'yes' })).toBe(
      false
    )
    expect(requestsInterceptedNetwork({})).toBe(false)
    expect(requestsInterceptedNetwork(undefined)).toBe(false)
  })
})

describe('NativeNetworkCapture', () => {
  const NATIVE = {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2'
  }
  const sink = () => ({ recordNetworkRequests: vi.fn() })
  const onLog = vi.fn()

  beforeEach(() => {
    execute.mockReset()
    onLog.mockReset()
  })

  it('starts a listener for a native session that asked for the proxy and records what it drains', async () => {
    const target = sink()
    const capture = new NativeNetworkCapture(target, onLog)
    execute.mockResolvedValueOnce('L1')
    await capture.start({ requested: true, capabilities: NATIVE, execute })
    execute.mockResolvedValueOnce([entry()]).mockResolvedValueOnce([entry()])
    await capture.forward()
    await capture.forward()
    expect(target.recordNetworkRequests).toHaveBeenCalledTimes(1)
    expect(onLog).toHaveBeenCalledWith('info', expect.any(String))
  })

  it('stays off unless asked, for a session with a document, and with no target', async () => {
    const capture = new NativeNetworkCapture(sink(), onLog)
    await capture.start({ requested: false, capabilities: NATIVE, execute })
    await capture.start({
      requested: true,
      capabilities: { platformName: 'Android', browserName: 'chrome' },
      execute
    })
    await capture.start(undefined)
    expect(execute).not.toHaveBeenCalled()
  })

  it('warns in neutral terms, or with the reason the adapter gives, when the driver is not reachable', async () => {
    const capture = new NativeNetworkCapture(sink(), onLog)
    await capture.start({
      requested: true,
      capabilities: NATIVE,
      execute: undefined
    })
    expect(onLog).toHaveBeenLastCalledWith(
      'warn',
      expect.stringContaining('cannot be reached outside the command path')
    )
    await capture.start({
      requested: true,
      capabilities: NATIVE,
      execute: undefined,
      unavailableReason: 'executeScript was not patched'
    })
    expect(onLog).toHaveBeenLastCalledWith(
      'warn',
      expect.stringContaining('executeScript was not patched')
    )
  })

  it('logs a read the transport answered with null', async () => {
    const capture = new NativeNetworkCapture(sink(), onLog)
    execute.mockResolvedValueOnce('L1')
    await capture.start({ requested: true, capabilities: NATIVE, execute })
    execute.mockResolvedValueOnce(null)
    await capture.forward()
    expect(onLog).toHaveBeenLastCalledWith(
      'warn',
      expect.stringContaining('no intercepted data')
    )
  })

  it('throttles per-command drains but never a boundary drain', async () => {
    let now = 10_000
    const capture = new NativeNetworkCapture(sink(), onLog, () => now)
    execute.mockResolvedValueOnce('L1')
    await capture.start({ requested: true, capabilities: NATIVE, execute })
    execute.mockResolvedValue([])
    const reads = () =>
      execute.mock.calls.filter(
        ([script]) => script === 'interceptor: getInterceptedData'
      ).length

    await capture.forward({ throttle: true })
    expect(reads()).toBe(1)
    now += NATIVE_NETWORK_DRAIN_INTERVAL_MS - 1
    await capture.forward({ throttle: true })
    expect(reads()).toBe(1)
    await capture.forward()
    expect(reads()).toBe(2)
    now += NATIVE_NETWORK_DRAIN_INTERVAL_MS
    await capture.forward({ throttle: true })
    expect(reads()).toBe(3)
  })

  it('does not throttle the first drain of a new session', async () => {
    const now = 10_000
    const capture = new NativeNetworkCapture(sink(), onLog, () => now)
    execute.mockResolvedValueOnce('L1')
    await capture.start({ requested: true, capabilities: NATIVE, execute })
    execute.mockResolvedValue([])
    await capture.forward({ throttle: true })
    execute.mockResolvedValueOnce('L2')
    await capture.start({ requested: true, capabilities: NATIVE, execute })
    await capture.forward({ throttle: true })
    expect(
      execute.mock.calls.filter(
        ([script]) => script === 'interceptor: getInterceptedData'
      )
    ).toHaveLength(2)
  })

  it('warns and forwards nothing when the plugin does not answer or the start throws', async () => {
    const target = sink()
    const capture = new NativeNetworkCapture(target, onLog)
    execute.mockResolvedValueOnce(null)
    await capture.start({ requested: true, capabilities: NATIVE, execute })
    execute.mockRejectedValueOnce(new Error('unknown command'))
    await capture.start({ requested: true, capabilities: NATIVE, execute })
    await capture.forward()
    expect(execute).toHaveBeenCalledTimes(2)
    expect(target.recordNetworkRequests).not.toHaveBeenCalled()
    expect(onLog).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('--use-plugins=appium-interceptor')
    )
    expect(onLog).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('unknown command')
    )
  })

  it('logs a failed read instead of rejecting', async () => {
    const capture = new NativeNetworkCapture(sink(), onLog)
    execute.mockResolvedValueOnce('L1')
    await capture.start({ requested: true, capabilities: NATIVE, execute })
    execute.mockRejectedValueOnce(new Error('session gone'))
    await expect(capture.forward()).resolves.toBeUndefined()
    expect(onLog).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('session gone')
    )
  })

  it('drops the old listener for a replaced session, and a start that a later one superseded', async () => {
    const capture = new NativeNetworkCapture(sink(), onLog)
    let answerFirst: (id: string) => void = () => {}
    execute.mockReturnValueOnce(
      new Promise((resolve) => {
        answerFirst = resolve
      })
    )
    const first = capture.start({
      requested: true,
      capabilities: NATIVE,
      execute
    })
    const second = vi.fn().mockResolvedValueOnce(null)
    await capture.start({
      requested: true,
      capabilities: NATIVE,
      execute: second
    })
    answerFirst('L1')
    await first
    await capture.forward()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('reads nothing once stopped', async () => {
    const capture = new NativeNetworkCapture(sink(), onLog)
    execute.mockResolvedValueOnce('L1')
    await capture.start({ requested: true, capabilities: NATIVE, execute })
    capture.stop()
    await capture.forward()
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
