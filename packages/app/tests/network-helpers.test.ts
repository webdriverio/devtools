import {
  REQUEST_TYPES,
  type NetworkRequest,
  type RequestType
} from '@wdio/devtools-shared'
import { describe, it, expect } from 'vitest'

import {
  statusKind,
  getStatusClass,
  getResourceType,
  getFileName
} from '../src/utils/network-helpers.js'
import {
  STATUS_KIND,
  RESOURCE_TYPES,
  RESOURCE_TYPE_BY_REQUEST_TYPE
} from '../src/utils/network-constants.js'

function request(overrides: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'req-1',
    url: 'https://example.com/page',
    method: 'GET',
    type: 'document',
    timestamp: 0,
    startTime: 0,
    ...overrides
  }
}

/** A `type` outside the union — an older trace, or a producer the vocabulary
 *  hasn't caught up with. The cast is the subject under test: the static type
 *  can't express this, and the helper still has to cope at runtime. */
function offVocabulary(
  type: string,
  overrides: Partial<NetworkRequest> = {}
): NetworkRequest {
  return { ...request(overrides), type: type as RequestType }
}

describe('statusKind', () => {
  it('buckets 2xx as ok', () => {
    expect(statusKind(200)).toBe(STATUS_KIND.OK)
    expect(statusKind(204)).toBe(STATUS_KIND.OK)
  })

  it('buckets 3xx as redirect', () => {
    expect(statusKind(301)).toBe(STATUS_KIND.REDIRECT)
    expect(statusKind(304)).toBe(STATUS_KIND.REDIRECT)
  })

  it('buckets 4xx/5xx as error', () => {
    expect(statusKind(404)).toBe(STATUS_KIND.ERROR)
    expect(statusKind(500)).toBe(STATUS_KIND.ERROR)
  })

  it('treats a missing status as pending', () => {
    expect(statusKind(undefined)).toBe(STATUS_KIND.PENDING)
  })

  it('treats an error flag as error regardless of status', () => {
    expect(statusKind(200, true)).toBe(STATUS_KIND.ERROR)
    expect(statusKind(undefined, true)).toBe(STATUS_KIND.ERROR)
  })
})

describe('getStatusClass', () => {
  it('derives the text colour from the status bucket', () => {
    expect(getStatusClass(200)).toBe('text-green-500')
    expect(getStatusClass(302)).toBe('text-yellow-500')
    expect(getStatusClass(404)).toBe('text-red-500')
    expect(getStatusClass(undefined)).toBe('text-gray-500')
  })
})

// Expectations here are literals on purpose: every bucket is named, never
// computed from the table the function reads, so a mapping that loses a
// category can't agree with its own test.
describe('getResourceType', () => {
  it('buckets every captured request type', () => {
    expect(getResourceType(request({ type: 'document' }))).toBe('HTML')
    expect(getResourceType(request({ type: 'stylesheet' }))).toBe('CSS')
    expect(getResourceType(request({ type: 'script' }))).toBe('JS')
    expect(getResourceType(request({ type: 'image' }))).toBe('Image')
    expect(getResourceType(request({ type: 'font' }))).toBe('Font')
    expect(getResourceType(request({ type: 'fetch' }))).toBe('Fetch')
    expect(getResourceType(request({ type: 'other' }))).toBe('Other')
  })

  it('names a bucket for every word in the shared vocabulary', () => {
    // The table is `Record<RequestType, ResourceType>`, so a new word breaks the
    // build; this guards the other direction — that no word was mapped by
    // accident to the residual it would have reached without an entry.
    expect(Object.keys(RESOURCE_TYPE_BY_REQUEST_TYPE).sort()).toEqual(
      [...REQUEST_TYPES].sort()
    )
  })

  it('shares one bucket between fetch and xhr', () => {
    expect(getResourceType(request({ type: 'xhr' }))).toBe('Fetch')
    expect(getResourceType(request({ type: 'fetch' }))).toBe('Fetch')
  })

  it('classifies a request with no response headers and no file extension', () => {
    expect(
      getResourceType(
        request({
          url: 'https://example.com/authenticate',
          type: 'document',
          responseHeaders: undefined
        })
      )
    ).toBe('HTML')
  })

  it('trusts the captured type over the response content-type', () => {
    // An XHR that fetched an HTML fragment: the capture side already decided
    // this is a data request, and re-sniffing the header would overrule it.
    expect(
      getResourceType(
        request({
          type: 'fetch',
          responseHeaders: { 'content-type': 'text/html; charset=utf-8' }
        })
      )
    ).toBe('Fetch')
  })

  it('reads a request whose type arrived capitalised', () => {
    expect(getResourceType(offVocabulary('Document'))).toBe('HTML')
  })

  it('treats a body-carrying method with an unknown type as a data request', () => {
    expect(getResourceType(offVocabulary('', { method: 'POST' }))).toBe('Fetch')
    expect(getResourceType(offVocabulary('websocket', { method: 'PUT' }))).toBe(
      'Fetch'
    )
  })

  it('falls back to Other for an unknown type on a plain GET', () => {
    expect(getResourceType(offVocabulary('websocket'))).toBe('Other')
    expect(getResourceType(offVocabulary(''))).toBe('Other')
  })

  it('leaves no filter tab that no captured request can reach', () => {
    const reachable = new Set<string>(
      REQUEST_TYPES.map((type) => getResourceType(request({ type })))
    )

    expect(
      RESOURCE_TYPES.filter((tab) => tab !== 'All' && !reachable.has(tab))
    ).toEqual([])
  })
})

describe('getFileName', () => {
  it('names a request after the last segment of its path', () => {
    expect(getFileName('https://example.com/js/vendor/jquery.min.js')).toBe(
      'jquery.min.js'
    )
    expect(getFileName('https://example.com/a/b/')).toBe('b')
  })

  it('falls back to the host when the path names no file', () => {
    expect(getFileName('https://example.com/')).toBe('example.com')
    expect(getFileName('https://example.com')).toBe('example.com')
    expect(getFileName('https://example.com/?limit=4')).toBe('example.com')
    // The host without its port — the column names the origin, not the socket.
    expect(getFileName('http://localhost:8080/?q=1')).toBe('localhost')
  })

  it('keeps a query-bearing path that is nothing but separators', () => {
    expect(getFileName('https://example.com//?q=1')).toBe('example.com//')
    // Without a query there is nothing to disambiguate, so the host stands alone.
    expect(getFileName('https://example.com//')).toBe('example.com')
  })

  it('normalises the host it displays', () => {
    expect(getFileName('https://münchen.example/?q=1')).toBe(
      'xn--mnchen-3ya.example'
    )
  })

  it('dashes a request with no URL of its own', () => {
    expect(getFileName('')).toBe('-')
    expect(getFileName('event')).toBe('-')
  })

  it('truncates a URL it cannot parse', () => {
    expect(getFileName('not a url')).toBe('not a url')
    expect(getFileName(`not a url ${'x'.repeat(60)}`)).toHaveLength(50)
  })
})
