import { describe, expect, it } from 'vitest'

import {
  isSkippedResourceHost,
  pageResourceKind,
  pageResourceMimeType
} from '../src/page-resources.js'

describe('pageResourceKind', () => {
  it.each([
    ['https://a.test/x', 'text/css; charset=utf-8', 'stylesheet'],
    ['https://a.test/x', 'font/woff2', 'font'],
    ['https://a.test/x', 'application/font-woff', 'font'],
    ['https://a.test/x', 'application/vnd.ms-fontobject', 'font'],
    ['https://a.test/x.woff', 'application/octet-stream', 'font'],
    ['https://a.test/x.css', null, 'stylesheet'],
    ['https://a.test/x.css', 'text/html', undefined],
    ['https://a.test/x.png', 'image/png', undefined],
    ['https://a.test/x.woff2', 'image/png', undefined]
  ])('%s as %s is %s', (url, type, kind) => {
    expect(pageResourceKind(url, type)).toBe(kind)
  })
})

describe('pageResourceMimeType', () => {
  it('keeps a named type and reads an untyped font off its path', () => {
    expect(pageResourceMimeType('https://a.test/x', 'font', 'font/ttf')).toBe(
      'font/ttf'
    )
    expect(
      pageResourceMimeType(
        'https://a.test/x.woff',
        'font',
        'application/octet-stream'
      )
    ).toBe('font/woff')
    expect(pageResourceMimeType('https://a.test/x', 'stylesheet', '')).toBe(
      'text/css'
    )
  })
})

describe('isSkippedResourceHost', () => {
  it('skips a listed host and its subdomains, never a lookalike', () => {
    expect(
      isSkippedResourceHost('https://www.google-analytics.com/a.css')
    ).toBe(true)
    expect(isSkippedResourceHost('https://hotjar.com/x.css')).toBe(true)
    expect(isSkippedResourceHost('https://nothotjar.com/x.css')).toBe(false)
    expect(isSkippedResourceHost('not a url')).toBe(true)
  })
})
