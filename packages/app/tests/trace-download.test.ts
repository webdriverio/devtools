import { describe, expect, it, vi } from 'vitest'

import {
  downloadTrace,
  traceUrlFrom
} from '../src/controller/trace-download.js'

const PAGE = new URL('https://trace.webdriver.io/')
const TRACE = new URL('https://ci.example.com/run/1/trace.zip')
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])

function served(
  body: BodyInit | null,
  init: ResponseInit = {},
  url = TRACE.href
): typeof fetch {
  return vi.fn<typeof fetch>(async () => {
    const response = new Response(body, init)
    Object.defineProperty(response, 'url', { value: url })
    return response
  })
}

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())

describe('traceUrlFrom', () => {
  it('accepts an https URL on any host', () => {
    expect(traceUrlFrom(TRACE.href, PAGE).href).toBe(TRACE.href)
  })

  it('resolves a relative URL against the page', () => {
    expect(traceUrlFrom('/fixtures/trace.zip', PAGE).href).toBe(
      'https://trace.webdriver.io/fixtures/trace.zip'
    )
  })

  it("accepts http only on the page's own origin", () => {
    const local = new URL('http://127.0.0.1:4173/')
    expect(traceUrlFrom('/t.zip', local).href).toBe(
      'http://127.0.0.1:4173/t.zip'
    )
    expect(() => traceUrlFrom('http://127.0.0.1:9000/t.zip', local)).toThrow(
      'Only https URLs can be opened, and this one is http:'
    )
  })

  it.each([
    'http://ci.example.com/trace.zip',
    'javascript:alert(1)',
    'data:application/zip;base64,UEsDBA==',
    'blob:https://trace.webdriver.io/1b2c',
    'file:///tmp/trace.zip',
    'ftp://ci.example.com/trace.zip'
  ])('refuses %s', (raw) => {
    expect(() => traceUrlFrom(raw, PAGE)).toThrow(/^Only https URLs/)
  })

  it('refuses a URL that carries credentials', () => {
    expect(() =>
      traceUrlFrom('https://user:secret@ci.example.com/t.zip', PAGE)
    ).toThrow('A trace URL cannot carry a user name or password')
  })

  it('refuses what is not a URL', () => {
    expect(() => traceUrlFrom('https://', PAGE)).toThrow(
      'The trace parameter is not a URL'
    )
  })
})

describe('downloadTrace', () => {
  it('returns the zip, fetched without credentials or a referrer', async () => {
    const fetchZip = served(ZIP)

    const blob = await downloadTrace(TRACE, { page: PAGE, fetch: fetchZip })

    expect(await bytesOf(blob)).toEqual(ZIP)
    expect(fetchZip).toHaveBeenCalledWith(TRACE, {
      credentials: 'omit',
      redirect: 'follow',
      mode: 'cors',
      referrerPolicy: 'no-referrer',
      signal: expect.any(AbortSignal)
    })
  })

  it('names the CORS header when the request itself fails', async () => {
    const fetchZip = vi.fn<typeof fetch>(() =>
      Promise.reject(new TypeError('Failed to fetch'))
    )

    await expect(
      downloadTrace(TRACE, { page: PAGE, fetch: fetchZip })
    ).rejects.toThrow(
      'The request to ci.example.com failed: the host must be reachable and send an Access-Control-Allow-Origin header that admits this page'
    )
  })

  it('reports the status of a failed response', async () => {
    await expect(
      downloadTrace(TRACE, {
        page: PAGE,
        fetch: served('gone', { status: 404, statusText: 'Not Found' })
      })
    ).rejects.toThrow('ci.example.com answered 404 Not Found')
  })

  it('aborts the request whose response it refuses, releasing the body', async () => {
    let signal: AbortSignal | undefined
    const fetchZip = vi.fn<typeof fetch>(async (_url, init) => {
      signal = init?.signal ?? undefined
      return new Response('gone', { status: 404 })
    })

    await expect(
      downloadTrace(TRACE, { page: PAGE, fetch: fetchZip })
    ).rejects.toThrow(/answered 404/)
    expect(signal?.aborted).toBe(true)
  })

  it('says how to pass a signed URL whole when the host refuses it', async () => {
    await expect(
      downloadTrace(TRACE, { page: PAGE, fetch: served('', { status: 403 }) })
    ).rejects.toThrow(
      'ci.example.com answered 403; a URL with its own query must be the last parameter, after `trace=`, or percent-encoded'
    )
  })

  it('stops a large body that does not start as a zip at its first chunk', async () => {
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        controller.enqueue(new TextEncoder().encode('<!doctype html>'))
      }
    })

    await expect(
      downloadTrace(TRACE, { page: PAGE, fetch: served(body) })
    ).rejects.toThrow('What ci.example.com served is not a zip archive')
    expect(pulled).toBeLessThan(3)
  })

  it('reads a signature split across chunks', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(ZIP.subarray(0, 2))
        controller.enqueue(ZIP.subarray(2))
        controller.close()
      }
    })

    const blob = await downloadTrace(TRACE, { page: PAGE, fetch: served(body) })

    expect(await bytesOf(blob)).toEqual(ZIP)
  })

  it('stops a host that never answers, and aborts the request', async () => {
    let signal: AbortSignal | undefined
    const fetchZip = vi.fn<typeof fetch>((_url, init) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>(() => {})
    })

    await expect(
      downloadTrace(TRACE, { page: PAGE, fetch: fetchZip, idleTimeoutMs: 20 })
    ).rejects.toThrow(
      'ci.example.com sent nothing for 0 s, so the download was stopped'
    )
    expect(signal?.aborted).toBe(true)
  })

  it('stops a body that stalls after its first chunk', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(ZIP)
      },
      cancel() {
        cancelled = true
      }
    })

    await expect(
      downloadTrace(TRACE, {
        page: PAGE,
        fetch: served(body),
        idleTimeoutMs: 20
      })
    ).rejects.toThrow(/sent nothing for/)
    expect(cancelled).toBe(true)
  })

  it('refuses a redirect that left https', async () => {
    await expect(
      downloadTrace(TRACE, {
        page: PAGE,
        fetch: served(ZIP, {}, 'http://ci.example.com/trace.zip')
      })
    ).rejects.toThrow('ci.example.com redirected to a URL that is not https')
  })

  it('refuses a body its declared length says is too large, before reading it', async () => {
    const fetchZip = served(ZIP, {
      headers: { 'content-length': String(3 * 1024 * 1024) }
    })

    await expect(
      downloadTrace(TRACE, {
        page: PAGE,
        fetch: fetchZip,
        maxBytes: 2 * 1024 * 1024
      })
    ).rejects.toThrow('The trace is larger than the 2 MB the player downloads')
  })

  it('stops reading a body that grows past the cap without declaring its length', async () => {
    const chunk = new Uint8Array(600)
    chunk.set(ZIP)
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        controller.enqueue(chunk)
      }
    })

    await expect(
      downloadTrace(TRACE, { page: PAGE, fetch: served(body), maxBytes: 1000 })
    ).rejects.toThrow(/larger than/)
    expect(pulled).toBeLessThan(5)
  })

  it('refuses a body that is not a zip', async () => {
    await expect(
      downloadTrace(TRACE, {
        page: PAGE,
        fetch: served('<!doctype html><title>login</title>')
      })
    ).rejects.toThrow('What ci.example.com served is not a zip archive')
  })

  it('accepts an empty archive', async () => {
    const empty = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...Array(18).fill(0)])

    const blob = await downloadTrace(TRACE, {
      page: PAGE,
      fetch: served(empty)
    })

    expect(blob.size).toBe(22)
  })

  it('reports a body that broke off mid-download', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(ZIP)
        controller.error(new TypeError('network error'))
      }
    })

    await expect(
      downloadTrace(TRACE, { page: PAGE, fetch: served(body) })
    ).rejects.toThrow('The download from ci.example.com was interrupted')
  })
})
