import { REQUEST_TYPES, isRequestType } from '@wdio/devtools-shared'
import { describe, it, expect } from 'vitest'

import { getRequestType } from '../src/request-type.js'
import { getRequestType as getRequestTypeViaNet } from '../src/net.js'

describe('getRequestType', () => {
  it('classifies from the response mime type', () => {
    expect(getRequestType('/x', 'text/html; charset=utf-8')).toBe('document')
    expect(getRequestType('/x', 'text/css')).toBe('stylesheet')
    expect(getRequestType('/x', 'application/javascript')).toBe('script')
    expect(getRequestType('/x', 'text/ecmascript')).toBe('script')
    expect(getRequestType('/x', 'image/png')).toBe('image')
    expect(getRequestType('/x', 'font/woff2')).toBe('font')
    expect(getRequestType('/x', 'application/font-woff')).toBe('font')
    expect(getRequestType('/x', 'application/json')).toBe('fetch')
  })

  it('reads the mime type case-insensitively', () => {
    expect(getRequestType('/x', 'TEXT/HTML')).toBe('document')
    expect(getRequestType('/x', 'Application/JSON')).toBe('fetch')
  })

  it('falls back to the URL extension when no mime type was observed', () => {
    expect(getRequestType('/a.html')).toBe('document')
    expect(getRequestType('/a.htm')).toBe('document')
    expect(getRequestType('/a.css')).toBe('stylesheet')
    expect(getRequestType('/a.js')).toBe('script')
    expect(getRequestType('/a.mjs')).toBe('script')
    expect(getRequestType('/a.PNG')).toBe('image')
    expect(getRequestType('/a.svg')).toBe('image')
    expect(getRequestType('/a.woff2')).toBe('font')
    expect(getRequestType('/a.ttf')).toBe('font')
  })

  it('prefers the mime type over a contradicting extension', () => {
    // A JSON API served from a `.html` path is a data request, not a document.
    expect(getRequestType('/a.html', 'application/json')).toBe('fetch')
  })

  it('returns the xhr fallback for a shape it cannot classify', () => {
    expect(getRequestType('/api/data')).toBe('xhr')
    expect(getRequestType('/api/data', 'application/octet-stream')).toBe('xhr')
    expect(getRequestType('')).toBe('xhr')
  })

  it('ignores a query string that looks like an extension', () => {
    // The extension test is anchored to the end of the URL, so a `?v=` cache
    // buster leaves the request unclassifiable rather than mis-bucketed.
    expect(getRequestType('/app.js?v=2')).toBe('xhr')
  })

  it('only ever returns a word from the shared vocabulary', () => {
    const urls = [
      '/x',
      '/a.html',
      '/a.css',
      '/a.js',
      '/a.png',
      '/a.woff',
      '/api/data'
    ]
    const mimes = [undefined, 'text/html', 'image/gif', 'application/json', '?']
    for (const url of urls) {
      for (const mime of mimes) {
        expect(isRequestType(getRequestType(url, mime))).toBe(true)
      }
    }
  })

  it('stays reachable under its pre-split import path', () => {
    // `net.js` re-exports it so importers predating the leaf-module split keep
    // working; the two names must be the same function, not two copies.
    expect(getRequestTypeViaNet).toBe(getRequestType)
  })
})

describe('isRequestType', () => {
  it('accepts every word in the vocabulary', () => {
    for (const type of REQUEST_TYPES) {
      expect(isRequestType(type)).toBe(true)
    }
  })

  it('rejects anything else', () => {
    expect(isRequestType('websocket')).toBe(false)
    expect(isRequestType('Document')).toBe(false)
    expect(isRequestType('')).toBe(false)
    expect(isRequestType(undefined)).toBe(false)
    expect(isRequestType(null)).toBe(false)
    expect(isRequestType(7)).toBe(false)
  })
})
