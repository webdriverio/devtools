// @vitest-environment happy-dom
//
// `renderNetworkRequestDetail` returns a Lit template, so it is exercised by
// rendering into a detached host and reading the DOM back — asserting the
// template's `strings` would test the source text, not what a user sees.
//
// Every expected value that production formats is computed here through the
// same exported helper the renderer calls (`formatBytes`, `formatTime`,
// `statusKind`, `contentType`) over the request under test, so a fixture that
// stops reaching its column fails. The user-visible strings are pinned as
// literals alongside, so a change in the formatters fails too.

import { describe, it, expect, beforeEach } from 'vitest'
import { render } from 'lit'
import type { NetworkRequest } from '@wdio/devtools-shared'

import { renderNetworkRequestDetail } from '../src/components/workbench/network/request-detail.js'
import { FAILED_STATUS_LABEL } from '../src/utils/network-constants.js'
import {
  contentType,
  formatBytes,
  formatTime,
  statusKind
} from '../src/utils/network-helpers.js'

function req(partial: Partial<NetworkRequest> = {}): NetworkRequest {
  return {
    id: 'req-1',
    url: 'https://the-internet.herokuapp.com/login',
    method: 'GET',
    timestamp: 0,
    startTime: 0,
    type: 'document',
    ...partial
  } as NetworkRequest
}

let host: HTMLElement

beforeEach(() => {
  host = document.createElement('div')
})

function detail(request: NetworkRequest): HTMLElement {
  render(renderNetworkRequestDetail(request), host)
  const root = host.querySelector<HTMLElement>('.request-detail')
  if (!root) {
    throw new Error('renderNetworkRequestDetail rendered no .request-detail')
  }
  return root
}

/** Trimmed, whitespace-collapsed text of every match. */
const texts = (root: Element, selector: string): string[] =>
  [...root.querySelectorAll(selector)].map((el) =>
    (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  )

interface Section {
  title: string
  keys: string[]
  values: string[]
}

const sections = (root: Element): Section[] =>
  [...root.querySelectorAll('.detail-section')].map((section) => ({
    title: texts(section, '.detail-title')[0] ?? '',
    keys: texts(section, '.k'),
    values: texts(section, '.v')
  }))

const sectionNamed = (root: Element, title: string): Section => {
  const found = sections(root).find((section) => section.title === title)
  if (!found) {
    throw new Error(`no detail section titled "${title}"`)
  }
  return found
}

const sectionTitles = (root: Element) =>
  sections(root).map((section) => section.title)

/** The value text of the General row labelled `key`, or `null` when the row was
 *  not rendered at all. Reading the row as an element is what separates "the row
 *  is missing" from "the row is there and reads empty": both answer `''` to a
 *  text query, which is how a dropped row hides. */
const generalValue = (root: Element, key: string): string | null => {
  const row = [...root.querySelectorAll('.kv')].find(
    (kv) => (kv.querySelector('.k')?.textContent ?? '').trim() === key
  )
  if (!row) {
    return null
  }
  return (row.querySelector('.v')?.textContent ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Class of the Status value cell — the renderer stamps `kind-<statusKind>`. */
const kindClassOf = (root: Element, index = 0): string | undefined =>
  [...root.querySelectorAll('.v')[index].classList].find((name) =>
    name.startsWith('kind-')
  )

/** Raw lines of a `<pre>` body — collapsing whitespace would erase the
 *  indentation that makes a pretty-printed body pretty-printed. */
const preLines = (root: Element, index = 0): string[] =>
  (root.querySelectorAll('pre')[index]?.textContent ?? '').split('\n')

describe('renderNetworkRequestDetail', () => {
  describe('General section', () => {
    it('renders the URL, method, status, type, timing and size of a finished request', () => {
      const request = req({
        url: 'https://the-internet.herokuapp.com/api/session',
        method: 'POST',
        type: 'fetch',
        status: 200,
        statusText: 'OK',
        responseHeaders: { 'content-type': 'application/json' },
        time: 8,
        size: 320
      })
      const root = detail(request)

      const general = sectionNamed(root, 'General')
      expect(general.keys).toEqual([
        'Request URL',
        'Method',
        'Status',
        'Type',
        'Time',
        'Size'
      ])
      // Derived: each cell must carry this request's own field through the
      // renderer's own formatter.
      expect(general.values).toEqual([
        request.url,
        request.method,
        `${request.status} ${request.statusText}`,
        contentType(request),
        formatTime(request.time),
        formatBytes(request.size)
      ])
      // Pinned: the strings a user actually reads.
      expect(general.values).toEqual([
        'https://the-internet.herokuapp.com/api/session',
        'POST',
        '200 OK',
        'application/json',
        '8ms',
        '320B'
      ])
    })

    it('renders only the General section for a request with no headers or bodies', () => {
      const root = detail(req({ status: 200 }))

      expect(sectionTitles(root)).toEqual(['General'])
    })

    it('dashes a status that never arrived and renders no status text', () => {
      const request = req({ status: undefined, statusText: undefined })
      const root = detail(request)

      const general = sectionNamed(root, 'General')
      expect(general.keys).toEqual(['Request URL', 'Method', 'Status', 'Type'])
      expect(general.values[2]).toBe('—')
    })

    it('renders a status code whose reason phrase was not captured', () => {
      const root = detail(req({ status: 204, statusText: undefined }))

      expect(sectionNamed(root, 'General').values[2]).toBe('204')
    })

    it('buckets the status into the kind class the shared helper returns', () => {
      const cases: Array<{ request: NetworkRequest; expected: string }> = [
        { request: req({ status: 200 }), expected: 'kind-ok' },
        { request: req({ status: 302 }), expected: 'kind-redirect' },
        { request: req({ status: 404 }), expected: 'kind-error' },
        { request: req({ status: 500 }), expected: 'kind-error' },
        { request: req({ status: undefined }), expected: 'kind-pending' },
        { request: req({ status: 100 }), expected: 'kind-pending' },
        {
          request: req({ status: 200, error: 'net::ERR_ABORTED' }),
          expected: 'kind-error'
        }
      ]

      for (const { request, expected } of cases) {
        host = document.createElement('div')
        const root = detail(request)
        const derived = `kind-${statusKind(request.status, Boolean(request.error))}`
        // Status is the third value cell of the General card.
        expect(kindClassOf(root, 2)).toBe(derived)
        expect(kindClassOf(root, 2)).toBe(expected)
      }
    })

    it('labels the type from the response content-type, dropping its charset', () => {
      const request = req({
        type: 'document',
        responseHeaders: { 'content-type': 'text/html; charset=utf-8' }
      })
      const root = detail(request)

      expect(sectionNamed(root, 'General').values[3]).toBe(contentType(request))
      expect(sectionNamed(root, 'General').values[3]).toBe('text/html')
    })

    it('falls back to the captured type when no response content-type arrived', () => {
      const request = req({ type: 'font', responseHeaders: {} })
      const root = detail(request)

      expect(sectionNamed(root, 'General').values[3]).toBe(contentType(request))
      expect(sectionNamed(root, 'General').values[3]).toBe('font')
    })

    it('dashes the type of a request with neither a content-type nor a type', () => {
      // `RequestType` has no empty member; the cast reproduces wire data that
      // arrived without one, which the renderer still has to survive.
      const request = req({ type: '' as NetworkRequest['type'] })
      const root = detail(request)

      expect(sectionNamed(root, 'General').values[3]).toBe(contentType(request))
      expect(sectionNamed(root, 'General').values[3]).toBe('-')
    })

    // `time` and `size` are optional, but 0 is a value a producer measures and
    // sends: a 204 transfers 0 bytes (the page collector's `#estimateSize`
    // returns 0 for a body it could not read), and a same-tick or cached
    // response is 0 ms (nightwatch's perf-log parser clamps its duration at 0).
    // Both rows used to be guarded on truthiness, so the fact was rendered as if
    // it had never been captured.
    it('reports the zero timing and zero size of a 204 as measured values', () => {
      const root = detail(
        req({
          method: 'DELETE',
          status: 204,
          statusText: 'No Content',
          time: 0,
          size: 0
        })
      )

      expect(sectionNamed(root, 'General').keys).toEqual([
        'Request URL',
        'Method',
        'Status',
        'Type',
        'Time',
        'Size'
      ])
      expect(generalValue(root, 'Time')).toBe(formatTime(0))
      expect(generalValue(root, 'Time')).toBe('0.00ms')
      // Not `formatBytes(0)`: that is the same dash the helper gives a size that
      // was never captured, so reusing it here would report the fact as unknown.
      expect(generalValue(root, 'Size')).not.toBe(formatBytes(0))
      expect(generalValue(root, 'Size')).toBe('0B')
    })

    // Each row answers for its own field: a request timed at 0 whose size was
    // never captured shows the timing and drops only the size.
    it('reports a zero timing while still dropping an absent size', () => {
      const root = detail(req({ status: 200, time: 0, size: undefined }))

      expect(generalValue(root, 'Time')).toBe('0.00ms')
      expect(generalValue(root, 'Size')).toBeNull()
    })

    // The counterpart to the test above: absent stays absent. Asserted as a
    // missing row rather than as empty text — a query that answers the same for
    // both is what let the zero rows disappear unnoticed.
    it('renders no timing or size row for a request that carries neither', () => {
      const root = detail(
        req({ status: 200, time: undefined, size: undefined })
      )

      expect(generalValue(root, 'Time')).toBeNull()
      expect(generalValue(root, 'Size')).toBeNull()
    })

    // `handleNetworkFetchError` in `service/src/session.ts` reports a transport
    // failure as status 0 plus the failure text, and sets no `error` field, so a
    // truthiness read files a request that demonstrably failed under "no status
    // yet" — dashed and coloured as pending, like a request still in flight.
    it('reads a status of 0 as a failure, not as a status that never arrived', () => {
      const failed = detail(
        req({ status: 0, statusText: 'net::ERR_NAME_NOT_RESOLVED' })
      )
      const failedStatus = generalValue(failed, 'Status')

      expect(failedStatus).toBe('ERR net::ERR_NAME_NOT_RESOLVED')
      expect(kindClassOf(failed, 2)).toBe('kind-error')

      // The same cell for a request that genuinely has no status yet, so the two
      // outcomes cannot both be satisfied by one rendering.
      host = document.createElement('div')
      const pending = detail(req({ status: undefined, statusText: undefined }))
      expect(generalValue(pending, 'Status')).not.toBe(failedStatus)
      expect(generalValue(pending, 'Status')).toBe('—')
      expect(kindClassOf(pending, 2)).toBe('kind-pending')
    })

    it('renders a sub-second timing in seconds', () => {
      const request = req({ status: 200, time: 1500 })
      const root = detail(request)

      const values = sectionNamed(root, 'General').values
      expect(values[4]).toBe(formatTime(request.time))
      expect(values[4]).toBe('1.5s')
    })

    it('renders a transport error as its own error-flagged row', () => {
      const request = req({
        status: undefined,
        error: 'net::ERR_CONNECTION_REFUSED',
        time: 200
      })
      const root = detail(request)

      const general = sectionNamed(root, 'General')
      expect(general.keys).toEqual([
        'Request URL',
        'Method',
        'Status',
        'Type',
        'Time',
        'Error'
      ])
      expect(general.values[5]).toBe('net::ERR_CONNECTION_REFUSED')
      // A request that reported an error before any status reads ERR, the same
      // as it does in the list column — never the dash that means "still going".
      expect(texts(root, '.v.kind-error')).toEqual([
        FAILED_STATUS_LABEL,
        'net::ERR_CONNECTION_REFUSED'
      ])
    })
  })

  describe('header sections', () => {
    it('renders one row per request and response header', () => {
      const root = detail(
        req({
          status: 200,
          requestHeaders: { accept: 'text/html', 'accept-encoding': 'gzip' },
          responseHeaders: { 'content-type': 'text/html', server: 'nginx' }
        })
      )

      expect(sectionNamed(root, 'Request Headers')).toEqual({
        title: 'Request Headers',
        keys: ['accept', 'accept-encoding'],
        values: ['text/html', 'gzip']
      })
      expect(sectionNamed(root, 'Response Headers').keys).toEqual([
        'content-type',
        'server'
      ])
    })

    it('renders no header section for headers that were not captured', () => {
      const root = detail(
        req({ status: 200, requestHeaders: undefined, responseHeaders: {} })
      )

      expect(sectionTitles(root)).toEqual(['General'])
    })

    it('renders no header section for an empty header bag', () => {
      const root = detail(req({ status: 200, requestHeaders: {} }))

      expect(sectionTitles(root)).toEqual(['General'])
    })
  })

  describe('body sections', () => {
    it('pretty-prints a JSON request and response body', () => {
      const root = detail(
        req({
          status: 200,
          requestBody: '{"sku":"AB-1","qty":2}',
          responseBody: '{"ok":true}'
        })
      )

      expect(sectionTitles(root)).toEqual([
        'General',
        'Request Body',
        'Response Body'
      ])
      expect(preLines(root, 0)).toEqual([
        '{',
        '  "sku": "AB-1",',
        '  "qty": 2',
        '}'
      ])
      expect(preLines(root, 1)).toEqual(['{', '  "ok": true', '}'])
    })

    it('renders a body that is not JSON verbatim', () => {
      const body = '<!doctype html>\n<html lang="en">'
      const root = detail(req({ status: 200, responseBody: body }))

      expect(preLines(root, 0)).toEqual(body.split('\n'))
    })

    it('renders a JSON scalar body as the scalar', () => {
      const root = detail(req({ status: 200, responseBody: '42' }))

      expect(preLines(root, 0)).toEqual(['42'])
    })

    it('renders no body section for a body that was not captured', () => {
      const root = detail(
        req({ status: 200, requestBody: undefined, responseBody: undefined })
      )

      expect(sectionTitles(root)).toEqual(['General'])
    })

    it('renders no body section for an empty body', () => {
      const root = detail(req({ status: 200, requestBody: '' }))

      expect(sectionTitles(root)).toEqual(['General'])
    })

    it('renders the sections in request-then-response order', () => {
      const root = detail(
        req({
          status: 200,
          requestHeaders: { accept: '*/*' },
          requestBody: '{"a":1}',
          responseHeaders: { server: 'nginx' },
          responseBody: '{"b":2}'
        })
      )

      expect(sectionTitles(root)).toEqual([
        'General',
        'Request Headers',
        'Request Body',
        'Response Headers',
        'Response Body'
      ])
    })
  })
})
