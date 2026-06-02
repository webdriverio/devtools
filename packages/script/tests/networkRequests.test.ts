/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NetworkRequestCollector } from '../src/collectors/networkRequests.js'

// happy-dom doesn't ship a Blob with reliable .size in some versions —
// fall back to a stub that returns the byte length so #estimateSize works
// without depending on the polyfill flavor we land on.
if (typeof globalThis.Blob === 'undefined') {
  ;(globalThis as unknown as { Blob: unknown }).Blob = class {
    size: number
    constructor(parts: BlobPart[]) {
      this.size = parts.reduce(
        (n, p) => n + (typeof p === 'string' ? p.length : 0),
        0
      )
    }
  }
}

let collector: NetworkRequestCollector
const realFetch = window.fetch
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  // Patch fetch BEFORE constructing the collector so the collector wraps
  // OUR mock and we can drive captures deterministically without real I/O.
  fetchMock = vi.fn()
  window.fetch = fetchMock as unknown as typeof fetch
  collector = new NetworkRequestCollector()
})

afterEach(() => {
  collector.clear()
  window.fetch = realFetch
})

describe('NetworkRequestCollector — lifecycle', () => {
  it('starts empty and clear() resets the buffer', () => {
    expect(collector.getArtifacts()).toEqual([])
    collector.clear()
    expect(collector.getArtifacts()).toEqual([])
    // Reference is stable across reads (callers can hold the array ref)
    expect(collector.getArtifacts()).toBe(collector.getArtifacts())
  })
})

describe('NetworkRequestCollector — fetch capture', () => {
  it('captures a successful JSON response with headers, body, timing, size', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"hello":"world"}', {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' }
      })
    )

    await window.fetch('https://api.example.com/data', {
      method: 'POST',
      headers: { 'x-trace': 'abc' },
      body: JSON.stringify({ q: 1 })
    })

    const artifacts = collector.getArtifacts()
    expect(artifacts).toHaveLength(1)
    const req = artifacts[0]
    expect(req).toMatchObject({
      url: 'https://api.example.com/data',
      method: 'POST',
      type: 'fetch',
      status: 200,
      statusText: 'OK',
      requestBody: JSON.stringify({ q: 1 }),
      responseBody: '{"hello":"world"}'
    })
    expect(req.requestHeaders).toMatchObject({ 'x-trace': 'abc' })
    expect(req.responseHeaders).toMatchObject({
      'content-type': 'application/json'
    })
    expect(req.startTime).toBeTypeOf('number')
    expect(req.endTime).toBeTypeOf('number')
    expect(req.time).toBeGreaterThanOrEqual(0)
  })

  it('skips internal protocols (data:, blob:, chrome:, about:, ws:)', async () => {
    for (const url of [
      'data:text/plain,hello',
      'blob:https://example.com/abc',
      'chrome://settings',
      'chrome-extension://abc/page',
      'about:blank',
      'ws://example.com',
      'wss://example.com'
    ]) {
      fetchMock.mockResolvedValueOnce(new Response(''))
      await window.fetch(url)
    }
    // Every call passed through to the original mock but NONE got captured
    expect(collector.getArtifacts()).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(7)
  })

  it('skips noise URLs (/favicon.ico, /.well-known/...)', async () => {
    fetchMock.mockResolvedValue(new Response(''))
    await window.fetch('https://example.com/favicon.ico')
    await window.fetch('https://example.com/.well-known/something')
    expect(collector.getArtifacts()).toEqual([])
  })

  it('extracts the URL from URL objects (URL.href, not toString)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"ok":1}', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    await window.fetch(new URL('https://example.com/x'))
    expect(collector.getArtifacts()[0].url).toBe('https://example.com/x')
  })

  // Known limitation: the collector reads `init?.method` only — when a
  // Request object is passed as the first arg with its own method, the
  // collector reports 'GET' (the default) because it doesn't inspect
  // Request.method. Pin the behavior here so a future change is intentional.
  it('reports GET for Request-object inputs with a non-GET Request.method (known limitation)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"ok":2}', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    await window.fetch(new Request('https://example.com/y', { method: 'PUT' }))
    const captured = collector.getArtifacts()[0]
    expect(captured.url).toBe('https://example.com/y')
    expect(captured.method).toBe('GET') // not 'PUT' — see comment above
  })

  it('does not capture an entry when the underlying fetch rejects, and re-throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    await expect(window.fetch('https://example.com/will-fail')).rejects.toThrow(
      'network down'
    )
    expect(collector.getArtifacts()).toEqual([])
  })

  it('extracts headers from all three accepted shapes (Headers, Array, plain object) and lowercases keys', async () => {
    // Headers instance
    fetchMock.mockResolvedValueOnce(
      new Response('a', {
        status: 200,
        headers: { 'content-type': 'text/plain' }
      })
    )
    await window.fetch('https://example.com/h1', {
      headers: new Headers({ 'X-One': '1' })
    })
    // [[k,v]] tuple array
    fetchMock.mockResolvedValueOnce(
      new Response('b', {
        status: 200,
        headers: { 'content-type': 'text/plain' }
      })
    )
    await window.fetch('https://example.com/h2', {
      headers: [['X-Two', '2']]
    })
    // Plain object
    fetchMock.mockResolvedValueOnce(
      new Response('c', {
        status: 200,
        headers: { 'content-type': 'text/plain' }
      })
    )
    await window.fetch('https://example.com/h3', {
      headers: { 'X-Three': '3' }
    })

    const reqs = collector.getArtifacts()
    expect(reqs[0].requestHeaders).toMatchObject({ 'x-one': '1' })
    expect(reqs[1].requestHeaders).toMatchObject({ 'x-two': '2' })
    expect(reqs[2].requestHeaders).toMatchObject({ 'x-three': '3' })
  })
})

describe('NetworkRequestCollector — XHR capture', () => {
  it('captures a successful JSON XHR (status + body + content-type filter passes)', async () => {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', 'https://api.example.com/xhr')

    // Patch the just-opened xhr to fake a successful JSON response without
    // hitting the network. happy-dom doesn't deliver `load` for a never-sent
    // request, so we wire up the response shape manually + fire the event.
    Object.defineProperty(xhr, 'status', { value: 200, configurable: true })
    Object.defineProperty(xhr, 'statusText', {
      value: 'OK',
      configurable: true
    })
    Object.defineProperty(xhr, 'responseText', {
      value: '{"id":42}',
      configurable: true
    })
    Object.defineProperty(xhr, 'getAllResponseHeaders', {
      value: () => 'content-type: application/json\r\nx-rate-limit: 99\r\n',
      configurable: true
    })

    xhr.send()
    xhr.dispatchEvent(new Event('load'))

    const reqs = collector.getArtifacts()
    expect(reqs).toHaveLength(1)
    expect(reqs[0]).toMatchObject({
      url: 'https://api.example.com/xhr',
      method: 'GET',
      type: 'xhr',
      status: 200,
      statusText: 'OK',
      responseBody: '{"id":42}'
    })
    expect(reqs[0].responseHeaders).toMatchObject({
      'content-type': 'application/json',
      'x-rate-limit': '99'
    })
  })

  it('skips ignored URLs in XHR open (does not record)', () => {
    const xhr = new XMLHttpRequest()
    xhr.open('GET', 'data:text/plain,hello')
    // The send + load aren't even needed — `open` was filtered, nothing in
    // the pending map, nothing to record on load.
    expect(collector.getArtifacts()).toEqual([])
  })

  it('captures request body for XHR POST + lowercases response headers', async () => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', 'https://api.example.com/submit')
    Object.defineProperty(xhr, 'status', { value: 201, configurable: true })
    Object.defineProperty(xhr, 'statusText', {
      value: 'Created',
      configurable: true
    })
    Object.defineProperty(xhr, 'responseText', {
      value: 'OK',
      configurable: true
    })
    Object.defineProperty(xhr, 'getAllResponseHeaders', {
      value: () => 'Content-Type: text/plain\r\n',
      configurable: true
    })

    xhr.send('payload-data')
    xhr.dispatchEvent(new Event('load'))

    const req = collector.getArtifacts()[0]
    expect(req.requestBody).toBe('payload-data')
    // Header key was uppercase "Content-Type" on the wire; the parser
    // lowercases for consistency with the fetch path.
    expect(req.responseHeaders).toHaveProperty('content-type', 'text/plain')
  })
})
