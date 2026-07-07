import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { parseTraceZip, readTraceZip } from '../src/trace-reader.js'

const sha1 = (data: string): string =>
  createHash('sha1').update(data).digest('hex')

const JSON_BODY = '{"answer":42}'
const HTML_BODY = '<p>hello</p>'
const PNG_BODY = 'not-really-a-png'

const toNdjson = (events: object[]): Uint8Array =>
  strToU8(events.map((event) => JSON.stringify(event)).join('\n') + '\n')

function networkEntry(url: string, content: Record<string, unknown>): object {
  return {
    type: 'resource-snapshot',
    snapshot: {
      startedDateTime: '2026-01-01T00:00:00.000Z',
      time: 50,
      request: {
        method: 'GET',
        url,
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: [],
        queryString: [],
        headersSize: -1,
        bodySize: -1
      },
      response: {
        status: 200,
        statusText: 'OK',
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: [],
        content,
        redirectURL: '',
        headersSize: -1,
        bodySize: -1
      },
      cache: {},
      timings: { send: 0, wait: 50, receive: 0 }
    }
  }
}

function fixtureZip(): Uint8Array {
  const events = [
    {
      type: 'context-options',
      wallTime: 1_000_000,
      browserName: 'chrome',
      contextId: 'context@abcd1234',
      options: { viewport: { width: 800, height: 600 } }
    }
  ]
  const network = [
    networkEntry('https://api.example.com/data', {
      size: JSON_BODY.length,
      mimeType: 'application/json',
      _sha1: sha1(JSON_BODY)
    }),
    networkEntry('https://example.com/inline', {
      size: 2,
      mimeType: 'text/plain',
      text: 'hi'
    }),
    networkEntry('https://example.com/logo.png', {
      size: PNG_BODY.length,
      mimeType: 'image/png',
      _sha1: sha1(PNG_BODY)
    }),
    // Foreign writers suffix the resource name with a mime extension.
    networkEntry('https://example.com/page', {
      size: HTML_BODY.length,
      mimeType: 'text/html; charset=utf-8',
      _sha1: `${sha1(HTML_BODY)}.html`
    }),
    networkEntry('https://example.com/missing', {
      size: 3,
      mimeType: 'application/json',
      _sha1: sha1('never-stored')
    }),
    networkEntry('https://example.com/prefers-text', {
      size: 4,
      mimeType: 'application/json',
      text: '"inline-wins"',
      _sha1: sha1(JSON_BODY)
    }),
    networkEntry('https://example.com/binary-inline', {
      size: 4,
      mimeType: 'application/octet-stream',
      text: 'AAAA',
      encoding: 'base64'
    })
  ]
  return zipSync({
    'trace.trace': toNdjson(events),
    'trace.network': toNdjson(network),
    [`resources/${sha1(JSON_BODY)}`]: strToU8(JSON_BODY),
    [`resources/${sha1(PNG_BODY)}`]: strToU8(PNG_BODY),
    [`resources/${sha1(HTML_BODY)}.html`]: strToU8(HTML_BODY)
  })
}

function bodyByUrl(url: string): string | undefined {
  const data = parseTraceZip(fixtureZip())
  const request = data.trace.networkRequests.find((r) => r.url === url)
  expect(request).toBeDefined()
  return request?.responseBody
}

describe('trace-reader response bodies', () => {
  it('restores the body from a content-addressed resource', () => {
    expect(bodyByUrl('https://api.example.com/data')).toBe(JSON_BODY)
  })

  it('restores the body from inline text', () => {
    expect(bodyByUrl('https://example.com/inline')).toBe('hi')
  })

  it('prefers inline text over the _sha1 resource', () => {
    expect(bodyByUrl('https://example.com/prefers-text')).toBe('"inline-wins"')
  })

  it('restores extension-suffixed _sha1 resource names', () => {
    expect(bodyByUrl('https://example.com/page')).toBe(HTML_BODY)
  })

  it('skips binary mime types', () => {
    expect(bodyByUrl('https://example.com/logo.png')).toBeUndefined()
  })

  it('skips base64-encoded inline text', () => {
    expect(bodyByUrl('https://example.com/binary-inline')).toBeUndefined()
  })

  it('leaves the body undefined when the resource is missing', () => {
    expect(bodyByUrl('https://example.com/missing')).toBeUndefined()
  })
})

// Machine-local foreign zip; exercises the extension-suffixed _sha1 convention
// against a real archive when present.
const REAL_FOREIGN_ZIP =
  '/Users/vishnu.p@browserstack.com/Documents/Test projects/Test-playwright/test-results/trace-features-trace-feature-showcase-chromium-retry2/trace.zip'

describe('foreign zip response bodies', () => {
  it.skipIf(!existsSync(REAL_FOREIGN_ZIP))(
    'restores bodies referenced via extension-suffixed _sha1 entries',
    async () => {
      const data = await readTraceZip(REAL_FOREIGN_ZIP)
      const requests = data.trace.networkRequests
      const apiRequest = requests.find((r) =>
        r.url.startsWith('https://api.github.com/')
      )
      expect(apiRequest?.responseBody).toContain('"full_name"')
      const css = requests.find((r) => r.url.endsWith('base.css'))
      expect(css?.responseBody?.length).toBeGreaterThan(0)
      // Entries without a _sha1 ref stay body-less.
      const script = requests.find((r) => r.url.endsWith('.js'))
      expect(script?.responseBody).toBeUndefined()
    }
  )
})
